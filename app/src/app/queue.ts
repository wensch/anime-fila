import { pickLargestImage } from './history';

/** Próximo episódio de uma série que ainda não foi assistido (já lançado). */
export interface NextEpisode {
  episodeId: string;
  number: number | null;
  title: string | null;
  coverUrl: string | null;
  /** Lançamento (ISO), se a API informou. */
  releasedAt: string | null;
}

/** Resultado guardado da busca do próximo episódio, válido enquanto o último visto não muda. */
export interface NextState {
  /** Episódio assistido por último, para o qual `next` foi calculado. */
  forEpisodeId: string;
  /** null = não há próximo lançado (série terminada ou em dia). */
  next: NextEpisode | null;
  checkedAt: number;
}

export interface CatalogSeason {
  id: string;
  number: number;
  /** Posição da temporada na série (season_sequence_number, senão o número). */
  order: number;
  dubbed: boolean;
}

export interface CatalogEpisode {
  id: string;
  number: number | null;
  sequence: number | null;
  title: string | null;
  coverUrl: string | null;
  releasedAt: string | null;
}

/** Onde o usuário parou: o que o histórico informa sobre o episódio assistido. */
export interface Position {
  seasonId: string | null;
  seasonNumber: number | null;
  sequence: number | null;
  number: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const time = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? 0 : t;
};

/** Resposta de /cms/series/{id}/seasons -> temporadas. */
export function normalizeSeasons(body: any): CatalogSeason[] {
  const out: CatalogSeason[] = [];
  for (const s of body?.data ?? []) {
    if (!s?.id) continue;
    const number = num(s.season_number) ?? 0;
    out.push({
      id: s.id,
      number,
      order: num(s.season_sequence_number) ?? number,
      dubbed: s.is_dubbed === true,
    });
  }
  return out;
}

/** Resposta de /cms/seasons/{id}/episodes -> episódios com data de lançamento. */
export function normalizeCatalogEpisodes(body: any): CatalogEpisode[] {
  const out: CatalogEpisode[] = [];
  for (const e of body?.data ?? []) {
    if (!e?.id) continue;
    out.push({
      id: e.id,
      number: num(e.episode_number ?? e.episode),
      sequence: num(e.sequence_number),
      title: e.title ?? null,
      coverUrl: pickLargestImage(e.images),
      releasedAt: e.premium_available_date ?? e.episode_air_date ?? e.availability_starts ?? null,
    });
  }
  return out;
}

/**
 * Procura o próximo episódio (já lançado) depois do que o usuário viu.
 * `load` devolve os episódios de uma temporada. Resultado:
 *  - NextEpisode: há o que assistir;
 *  - null: não há próximo lançado (série terminada, ou em dia com os lançamentos);
 *  - undefined: não deu para saber (faltam dados) — quem chama deve manter a série na fila.
 */
export async function findNext(
  cur: Position,
  seasons: CatalogSeason[],
  load: (seasonId: string) => Promise<CatalogEpisode[]>,
  now = Date.now(),
): Promise<NextEpisode | null | undefined> {
  if (seasons.length === 0) return undefined;
  const orders = [...new Set(seasons.map((s) => s.order))].sort((a, b) => a - b);
  const curOrder =
    seasons.find((s) => cur.seasonId !== null && s.id === cur.seasonId)?.order ??
    seasons.find((s) => cur.seasonNumber !== null && s.number === cur.seasonNumber)?.order ??
    (orders.length === 1 ? orders[0] : undefined);
  const curPos = cur.sequence ?? cur.number;
  if (curOrder === undefined || curPos === null) return undefined;

  for (const order of orders.filter((o) => o >= curOrder)) {
    // Várias versões (legendado/dublado) da mesma temporada: usa uma só, preferindo a legendada.
    const group = seasons.filter((s) => s.order === order);
    const season = group.find((s) => !s.dubbed) ?? group[0];
    const eps = await load(season.id);
    const pool =
      order === curOrder ? eps.filter((e) => (e.sequence ?? e.number ?? -Infinity) > curPos) : eps;
    if (pool.length === 0) continue; // nada depois aqui: tenta a próxima temporada
    const released = pool.filter((e) => time(e.releasedAt) === 0 || time(e.releasedAt) <= now);
    if (released.length === 0) return null; // só há episódios que ainda não saíram
    released.sort(
      (a, b) => (a.sequence ?? a.number ?? Infinity) - (b.sequence ?? b.number ?? Infinity),
    );
    const n = released[0];
    return {
      episodeId: n.id,
      number: n.number,
      title: n.title,
      coverUrl: n.coverUrl,
      releasedAt: n.releasedAt,
    };
  }
  return null;
}

/** Precisa buscar de novo? Sim se nunca buscou, se o último visto mudou ou se o resultado envelheceu. */
export function needsResolve(
  state: NextState | undefined,
  latestEpisodeId: string,
  now: number,
  ttlWithNextMs: number,
  ttlWithoutNextMs: number,
): boolean {
  if (!state || state.forEpisodeId !== latestEpisodeId) return true;
  return now - state.checkedAt > (state.next ? ttlWithNextMs : ttlWithoutNextMs);
}
