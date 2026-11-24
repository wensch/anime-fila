import { describe, expect, it } from 'vitest';
import { BgConfig, BgError, run } from './bg-sync';
import { NextState } from './queue';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

/** Episódio do histórico: todos assistidos por completo, 9º da 1ª temporada. */
const hist = (sid: string, watchedDaysAgo: number, over: Record<string, unknown> = {}) => ({
  date_played: iso(watchedDaysAgo),
  playhead: 1400,
  panel: {
    id: `e-${sid}`,
    title: `Ep ${sid}`,
    episode_metadata: {
      series_id: sid,
      series_title: `Série ${sid}`,
      episode_number: 9,
      season_id: `T-${sid}`,
      season_number: 1,
      sequence_number: 9,
      duration_ms: 1_400_000,
    },
    images: { thumbnail: [[{ width: 640, source: `https://img/${sid}.jpg` }]] },
  },
  ...over,
});

const baseCfg = (next: Record<string, NextState> = {}): BgConfig => ({
  baseUrl: 'https://www.crunchyroll.com',
  basicAuth: 'abc',
  historyPath: '/content/v2/{account}/watch-history',
  seasonsPath: '/content/v2/cms/series/{id}/seasons',
  episodesPath: '/content/v2/cms/seasons/{id}/episodes',
  locale: 'pt-BR',
  accountId: 'acc',
  deviceId: 'dev',
  next,
});

interface World {
  history: unknown[];
  /** seriesId -> próximo episódio (ou ausente = terminou) */
  nextOf: Record<string, { id: string; n: number; daysAgo: number } | undefined>;
  tokenStatus?: number;
  failSeries?: string[];
}

function fakeFetch(w: World) {
  const calls: { method: string; path: string }[] = [];
  const json = (data: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ method, path: url.pathname });
    if (url.pathname === '/auth/v1/token') {
      return w.tokenStatus && w.tokenStatus !== 200
        ? json({}, w.tokenStatus)
        : json({ access_token: 't', account_id: 'acc' });
    }
    if (url.pathname.endsWith('/watch-history')) return json({ data: w.history });
    let m = url.pathname.match(/series\/(.+)\/seasons$/);
    if (m) {
      if (w.failSeries?.includes(m[1])) return json({}, 500);
      return json({ data: [{ id: `T-${m[1]}`, season_number: 1 }] });
    }
    m = url.pathname.match(/seasons\/T-(.+)\/episodes$/);
    if (m) {
      const sid = m[1];
      const eps: unknown[] = [
        { id: `e-${sid}`, episode_number: 9, sequence_number: 9, premium_available_date: iso(60) },
      ];
      const n = w.nextOf[sid];
      if (n) {
        eps.push({
          id: n.id,
          title: 'Próximo',
          episode_number: n.n,
          sequence_number: n.n,
          premium_available_date: iso(n.daysAgo),
        });
      }
      return json({ data: eps });
    }
    return json({}, 404);
  }) as typeof fetch;
  return { f, calls };
}

const deps = (f: typeof fetch) => ({ fetch: f, now: () => NOW, sleep: async () => {} });

describe('atualização em segundo plano (bg-sync)', () => {
  it('terminada some, com próximo mostra o próximo, na ordem de lançamento', async () => {
    const { f } = fakeFetch({
      history: [hist('A', 1), hist('B', 2), hist('C', 3)],
      nextOf: {
        A: undefined,
        B: { id: 'b10', n: 10, daysAgo: 1 },
        C: { id: 'c10', n: 10, daysAgo: 6 },
      },
    });
    const r = await run(baseCfg(), deps(f));
    expect(r.items.map((i) => i.seriesId)).toEqual(['B', 'C']); // A terminou
    expect(r.items[0]).toMatchObject({ episodeId: 'b10', episode: 'Ep. 10', hasRelease: true });
    expect(r.accountId).toBe('acc');
    expect(r.next['A']).toMatchObject({ forEpisodeId: 'e-A', next: null });
  });

  it('episódio parado no meio continua o mesmo, sem consultar o catálogo', async () => {
    const { f, calls } = fakeFetch({
      history: [hist('A', 1, { playhead: 300 })],
      nextOf: {},
    });
    const r = await run(baseCfg(), deps(f));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ episodeId: 'e-A', progress: expect.any(Number) });
    expect(calls.some((c) => c.path.includes('/cms/'))).toBe(false);
  });

  it('usa o resultado guardado e não consulta o catálogo de novo', async () => {
    const cached: Record<string, NextState> = {
      A: { forEpisodeId: 'e-A', next: null, checkedAt: NOW - 3_600_000 },
    };
    const { f, calls } = fakeFetch({ history: [hist('A', 1)], nextOf: {} });
    const r = await run(baseCfg(cached), deps(f));
    expect(r.items).toEqual([]);
    expect(calls.some((c) => c.path.includes('/cms/'))).toBe(false);
  });

  it('assistiu o próximo episódio: o resultado velho é descartado e busca de novo', async () => {
    const cached: Record<string, NextState> = {
      A: {
        forEpisodeId: 'e-A-antigo',
        next: { episodeId: 'x', number: 9, title: null, coverUrl: null, releasedAt: null },
        checkedAt: NOW,
      },
    };
    const { f, calls } = fakeFetch({
      history: [hist('A', 0.1)],
      nextOf: { A: { id: 'a10', n: 10, daysAgo: 0.5 } },
    });
    const r = await run(baseCfg(cached), deps(f));
    expect(calls.some((c) => c.path.includes('/cms/'))).toBe(true);
    expect(r.items[0].episodeId).toBe('a10');
  });

  it('falha numa série deixa só ela na fila e não derruba as outras', async () => {
    const { f } = fakeFetch({
      history: [hist('A', 1), hist('B', 2)],
      nextOf: { B: undefined },
      failSeries: ['A'],
    });
    const r = await run(baseCfg(), deps(f));
    expect(r.items.map((i) => i.seriesId)).toEqual(['A']); // A: sem dados, continua; B: terminou
    expect(r.next['A']).toBeUndefined();
  });

  it('sessão expirada vira BgError SESSION (o widget pede para abrir o app)', async () => {
    const { f } = fakeFetch({ history: [], nextOf: {}, tokenStatus: 401 });
    const err = await run(baseCfg(), deps(f)).catch((e) => e);
    expect(err).toBeInstanceOf(BgError);
    expect((err as BgError).code).toBe('SESSION');
  });

  it('só faz GET no catálogo e no histórico (o POST é só o do token)', async () => {
    const { f, calls } = fakeFetch({ history: [hist('A', 1)], nextOf: {} });
    await run(baseCfg(), deps(f));
    const posts = calls.filter((c) => c.method !== 'GET');
    expect(posts).toEqual([{ method: 'POST', path: '/auth/v1/token' }]);
  });

  it('limita quantas séries são consultadas por execução', async () => {
    const history = Array.from({ length: 20 }, (_, i) => hist('S' + i, i + 1));
    const { f, calls } = fakeFetch({ history, nextOf: {} });
    await run(baseCfg(), deps(f));
    const seasonCalls = calls.filter((c) => c.path.endsWith('/seasons')).length;
    expect(seasonCalls).toBe(12);
  });
});
