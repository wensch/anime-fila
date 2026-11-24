/**
 * Atualização em segundo plano da fila "Continuar assistindo" (widgets da tela inicial).
 *
 * Este arquivo é empacotado (esbuild) em `bg-sync.js` e executado dentro de um WebView escondido
 * com o site da Crunchyroll aberto, sem o app aberto: faz o login pelo cookie da sessão, lê o
 * histórico, descobre o próximo episódio de cada série (mesma lógica do app) e devolve a lista
 * pronta para os widgets. Nada aqui depende do Angular.
 */
import {
  AUTH_PATH,
  NEXT_TTL_EMPTY_MS,
  NEXT_TTL_MS,
  QUEUE_CANDIDATES,
  QUEUE_CONCURRENCY,
} from './endpoints';
import { continueWatching, isWatched, latestPerSeries, normalizeHistoryItem } from './history';
import { Episode } from './models';
import {
  NextState,
  findNext,
  needsResolve,
  normalizeCatalogEpisodes,
  normalizeSeasons,
} from './queue';
import { WidgetPushItem, toWidgetPayload } from './widget';
import { normalizeWatchlist } from './watchlist';

export interface BgConfig {
  baseUrl: string;
  basicAuth: string;
  historyPath: string;
  /** Lista "Continuar assistindo" da Crunchyroll; vazio = só o histórico. */
  watchlistPath?: string;
  seasonsPath: string;
  episodesPath: string;
  locale: string;
  accountId: string | null;
  deviceId: string;
  /** Resultado da busca do próximo episódio de cada série, da execução anterior. */
  next: Record<string, NextState>;
  /** Tempo (ms) depois do qual não começa novas buscas no catálogo. */
  budgetMs?: number;
}

export interface BgResult {
  items: WidgetPushItem[];
  next: Record<string, NextState>;
  accountId: string;
  /** De onde veio a lista: a da própria Crunchyroll ou montada a partir do histórico. */
  source: 'watchlist' | 'history';
}

/** SESSION = a sessão da Crunchyroll caiu (é preciso entrar de novo no app). */
export class BgError extends Error {
  constructor(
    readonly code: 'SESSION' | 'HTTP',
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export interface BgDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** Episódios do histórico lidos por execução (2 páginas de 100). */
const HISTORY_PAGES = 2;
/** Séries com busca de próximo episódio por execução: o resto fica para a próxima. */
const MAX_RESOLVE_PER_RUN = 12;
/** Depois disso não começa novas buscas (o WebView tem um tempo limite). */
const BUDGET_MS = 45_000;

const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k]));

export async function run(cfg: BgConfig, deps?: Partial<BgDeps>): Promise<BgResult> {
  const d: BgDeps = {
    fetch: deps?.fetch ?? ((input, init) => fetch(input, init)),
    now: deps?.now ?? (() => Date.now()),
    sleep: deps?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
  const started = d.now();

  // 1) Troca o cookie da sessão por um token (como o app faz).
  const form = new URLSearchParams({
    grant_type: 'etp_rt_cookie',
    scope: 'offline_access',
    device_id: cfg.deviceId,
    device_type: 'Chrome on Android',
  });
  const tokenRes = await d.fetch(cfg.baseUrl + AUTH_PATH, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${cfg.basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
    credentials: 'include',
  });
  if (tokenRes.status === 400 || tokenRes.status === 401) {
    throw new BgError('SESSION', `token ${tokenRes.status}`);
  }
  if (!tokenRes.ok) throw new BgError('HTTP', `token ${tokenRes.status}`);
  const tok: any = await tokenRes.json();
  if (!tok?.access_token) throw new BgError('HTTP', 'resposta sem access_token');
  const accountId: string | null = tok.account_id ?? cfg.accountId;
  if (!accountId) throw new BgError('HTTP', 'sem account_id');

  const get = async (path: string, params: Record<string, string>): Promise<any> => {
    const url = new URL(cfg.baseUrl + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      const res = await d.fetch(url.toString(), {
        headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' },
        credentials: 'include',
      });
      if (res.ok) return res.json();
      if (res.status === 401) throw new BgError('SESSION', 'API 401');
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await d.sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new BgError('HTTP', `${res.status} em ${path}`);
    }
  };

  // 2) A lista "Continuar assistindo" da própria Crunchyroll, quando ela responde no formato esperado.
  if (cfg.watchlistPath) {
    try {
      const body = await get(fill(cfg.watchlistPath, { account: accountId }), {
        n: '100',
        order: 'desc',
        locale: cfg.locale,
      });
      const queue = normalizeWatchlist(body);
      if (queue !== null) {
        return {
          items: toWidgetPayload(queue),
          next: cfg.next ?? {},
          accountId,
          source: 'watchlist',
        };
      }
    } catch (err) {
      if (err instanceof BgError && err.code === 'SESSION') throw err;
      // indisponível: segue com o histórico
    }
  }

  // 3) Plano B: histórico recente.
  const byId = new Map<string, Episode>();
  const historyPath = fill(cfg.historyPath, { account: accountId });
  for (let page = 1; page <= HISTORY_PAGES; page++) {
    const body = await get(historyPath, {
      page: String(page),
      page_size: '100',
      locale: cfg.locale,
    });
    const data: any[] = body?.data ?? [];
    for (const raw of data) {
      const ep = normalizeHistoryItem(raw);
      if (ep) byId.set(ep.episodeId, ep);
    }
    if (data.length < 100) break;
  }
  const episodes = [...byId.values()];
  const latest = latestPerSeries(episodes).slice(0, QUEUE_CANDIDATES);

  // 4) Próximo episódio das séries cujo último episódio já terminou (com resultado guardado).
  const next: Record<string, NextState> = {};
  for (const e of latest) if (cfg.next?.[e.seriesId]) next[e.seriesId] = cfg.next[e.seriesId];
  const todo = latest
    .filter(
      (e) =>
        isWatched(e) &&
        needsResolve(next[e.seriesId], e.episodeId, d.now(), NEXT_TTL_MS, NEXT_TTL_EMPTY_MS),
    )
    .slice(0, MAX_RESOLVE_PER_RUN);
  const params = { locale: cfg.locale };
  const worker = async (): Promise<void> => {
    for (let e = todo.shift(); e; e = todo.shift()) {
      if (d.now() - started > (cfg.budgetMs ?? BUDGET_MS)) return;
      try {
        const seasons = normalizeSeasons(
          await get(fill(cfg.seasonsPath, { id: e.seriesId }), params),
        );
        const found = await findNext(
          {
            seasonId: e.seasonId ?? null,
            seasonNumber: e.seasonNumber ?? null,
            sequence: e.sequence ?? null,
            number: e.episodeNumber,
          },
          seasons,
          async (seasonId) =>
            normalizeCatalogEpisodes(await get(fill(cfg.episodesPath, { id: seasonId }), params)),
          d.now(),
        );
        if (found === undefined) continue; // sem dados: a série fica na fila como está
        next[e.seriesId] = { forEpisodeId: e.episodeId, next: found, checkedAt: d.now() };
      } catch (err) {
        if (err instanceof BgError && err.code === 'SESSION') throw err;
        // falha só dessa série: segue com as outras
      }
    }
  };
  await Promise.all(Array.from({ length: QUEUE_CONCURRENCY }, () => worker()));

  // 5) Fila final, no formato dos widgets.
  return {
    items: toWidgetPayload(continueWatching(episodes, 10, next)),
    next,
    accountId,
    source: 'history',
  };
}
