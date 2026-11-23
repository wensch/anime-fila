import { describe, expect, it } from 'vitest';
import {
  CatalogEpisode,
  CatalogSeason,
  NextState,
  findNext,
  needsResolve,
  normalizeCatalogEpisodes,
  normalizeSeasons,
} from './queue';
import { continueWatching, isWatched, latestPerSeries, normalizeHistoryItem } from './history';
import { Episode } from './models';

const now = Date.parse('2026-10-10T12:00:00Z');
const ep = (
  n: number,
  seq = n,
  released: string | null = '2026-01-01T00:00:00Z',
  id = `e${n}`,
): CatalogEpisode => ({
  id,
  number: n,
  sequence: seq,
  title: `Ep ${n}`,
  coverUrl: `img-${n}`,
  releasedAt: released,
});
const season = (id: string, order: number, dubbed = false): CatalogSeason => ({
  id,
  number: order,
  order,
  dubbed,
});
const pos = (seasonId: string | null, sequence: number | null, number = sequence) => ({
  seasonId,
  seasonNumber: null,
  sequence,
  number,
});
const loader = (map: Record<string, CatalogEpisode[]>) => async (id: string) => map[id] ?? [];

describe('findNext', () => {
  it('devolve o episódio seguinte na mesma temporada', async () => {
    const r = await findNext(
      pos('S1', 9),
      [season('S1', 1)],
      loader({ S1: [ep(8), ep(9), ep(10), ep(11)] }),
      now,
    );
    expect(r?.number).toBe(10);
    expect(r?.coverUrl).toBe('img-10');
  });

  it('terminou a série: sem próximo', async () => {
    const r = await findNext(
      pos('S1', 12),
      [season('S1', 1)],
      loader({ S1: [ep(11), ep(12)] }),
      now,
    );
    expect(r).toBeNull();
  });

  it('em dia com os lançamentos: o seguinte ainda não saiu', async () => {
    const future = '2026-10-17T00:00:00Z';
    const r = await findNext(
      pos('S1', 5),
      [season('S1', 1)],
      loader({ S1: [ep(5), ep(6, 6, future)] }),
      now,
    );
    expect(r).toBeNull();
  });

  it('pula episódios futuros e pega o primeiro já lançado', async () => {
    const r = await findNext(
      pos('S1', 5),
      [season('S1', 1)],
      loader({ S1: [ep(5), ep(7, 7, '2026-10-20T00:00:00Z'), ep(6, 6, '2026-10-01T00:00:00Z')] }),
      now,
    );
    expect(r?.number).toBe(6);
  });

  it('acabou a temporada: segue para a próxima', async () => {
    const r = await findNext(
      pos('S1', 12),
      [season('S1', 1), season('S2', 2)],
      loader({
        S1: [ep(12)],
        S2: [ep(1, 1, '2026-02-01T00:00:00Z', 's2e1'), ep(2, 2, '2026-02-08T00:00:00Z', 's2e2')],
      }),
      now,
    );
    expect(r?.episodeId).toBe('s2e1');
  });

  it('temporadas em ordem mesmo fora de ordem na resposta; ignora a dublada', async () => {
    let loaded: string[] = [];
    const load = async (id: string) => {
      loaded.push(id);
      return id === 'S2' ? [ep(1, 1, '2026-02-01T00:00:00Z', 's2e1')] : [ep(12)];
    };
    const r = await findNext(
      pos('S1', 12),
      [season('S2dub', 2, true), season('S2', 2), season('S1', 1)],
      load,
      now,
    );
    expect(r?.episodeId).toBe('s2e1');
    expect(loaded).toEqual(['S1', 'S2']); // a versão dublada não é consultada
  });

  it('próxima temporada só com episódios futuros: sem próximo', async () => {
    const r = await findNext(
      pos('S1', 12),
      [season('S1', 1), season('S2', 2)],
      loader({ S1: [ep(12)], S2: [ep(1, 1, '2027-01-01T00:00:00Z')] }),
      now,
    );
    expect(r).toBeNull();
  });

  it('usa o número da temporada quando o id da temporada não bate (versão dublada)', async () => {
    const r = await findNext(
      { seasonId: 'OUTRO', seasonNumber: 1, sequence: 3, number: 3 },
      [season('S1', 1), season('S2', 2)],
      loader({ S1: [ep(3), ep(4)], S2: [] }),
      now,
    );
    expect(r?.number).toBe(4);
  });

  it('sem dados para localizar o episódio: indefinido (a série fica na fila)', async () => {
    expect(
      await findNext(pos(null, 3), [season('A', 1), season('B', 2)], loader({}), now),
    ).toBeUndefined();
    expect(
      await findNext(pos('S1', null, null), [season('S1', 1)], loader({}), now),
    ).toBeUndefined();
    expect(await findNext(pos('S1', 3), [], loader({}), now)).toBeUndefined();
  });

  it('uma só temporada sem id nem número: usa essa temporada', async () => {
    const r = await findNext(pos(null, 3), [season('S1', 1)], loader({ S1: [ep(3), ep(4)] }), now);
    expect(r?.number).toBe(4);
  });
});

describe('normalização do catálogo', () => {
  it('temporadas: número, ordem e dublagem', () => {
    const out = normalizeSeasons({
      data: [
        { id: 'a', season_number: 2, season_sequence_number: 5, is_dubbed: true },
        { id: 'b', season_number: 1 },
        { season_number: 9 },
      ],
    });
    expect(out).toEqual([
      { id: 'a', number: 2, order: 5, dubbed: true },
      { id: 'b', number: 1, order: 1, dubbed: false },
    ]);
  });

  it('episódios: prefere premium_available_date e lê a imagem', () => {
    const [e] = normalizeCatalogEpisodes({
      data: [
        {
          id: 'x',
          title: 'T',
          episode_number: 4,
          sequence_number: 4,
          premium_available_date: '2026-09-01T00:00:00Z',
          episode_air_date: '2026-08-01T00:00:00Z',
          images: { thumbnail: [[{ width: 640, source: 'big' }]] },
        },
      ],
    });
    expect(e.releasedAt).toBe('2026-09-01T00:00:00Z');
    expect(e.coverUrl).toBe('big');
    expect(e.number).toBe(4);
  });
});

describe('needsResolve', () => {
  const H = 3_600_000;
  const state = (over: Partial<NextState> = {}): NextState => ({
    forEpisodeId: 'e1',
    next: null,
    checkedAt: now,
    ...over,
  });
  it('busca quando nunca buscou ou o último visto mudou', () => {
    expect(needsResolve(undefined, 'e1', now, 24 * H, 6 * H)).toBe(true);
    expect(needsResolve(state(), 'e2', now, 24 * H, 6 * H)).toBe(true);
  });
  it('sem próximo vale 6 h; com próximo vale 24 h', () => {
    expect(needsResolve(state({ checkedAt: now - 5 * H }), 'e1', now, 24 * H, 6 * H)).toBe(false);
    expect(needsResolve(state({ checkedAt: now - 7 * H }), 'e1', now, 24 * H, 6 * H)).toBe(true);
    const withNext = state({
      next: { episodeId: 'n', number: 2, title: null, coverUrl: null, releasedAt: null },
      checkedAt: now - 7 * H,
    });
    expect(needsResolve(withNext, 'e1', now, 24 * H, 6 * H)).toBe(false);
  });
});

describe('fila com próximo episódio', () => {
  const watched = (
    id: string,
    sid: string,
    played: string,
    over: Partial<Episode> = {},
  ): Episode => ({
    episodeId: id,
    seriesId: sid,
    seriesTitle: 'Série ' + sid,
    episodeTitle: null,
    episodeNumber: 5,
    coverUrl: 'old-' + id,
    watchedAt: played,
    progress: 1,
    ...over,
  });
  const nextEp = {
    episodeId: 'n',
    number: 6,
    title: 'Ep 6',
    coverUrl: 'new',
    releasedAt: '2026-10-09T00:00:00Z',
  };

  it('série terminada some; com próximo mostra o próximo e a data dele', () => {
    const eps = [
      watched('a5', 'A', '2026-10-01T00:00:00Z'),
      watched('b5', 'B', '2026-10-02T00:00:00Z'),
    ];
    const states: Record<string, NextState> = {
      A: { forEpisodeId: 'a5', next: null, checkedAt: now },
      B: { forEpisodeId: 'b5', next: nextEp, checkedAt: now },
    };
    const out = continueWatching(eps, 20, states);
    expect(out.map((c) => c.seriesId)).toEqual(['B']);
    expect(out[0]).toMatchObject({
      episodeNumber: 6,
      coverUrl: 'new',
      isNext: true,
      hasRelease: true,
      progress: null,
    });
  });

  it('episódio parado no meio continua o mesmo, mesmo com resultado guardado', () => {
    const eps = [watched('a5', 'A', '2026-10-01T00:00:00Z', { progress: 0.4 })];
    const states: Record<string, NextState> = {
      A: { forEpisodeId: 'a5', next: null, checkedAt: now },
    };
    const out = continueWatching(eps, 20, states);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ episodeNumber: 5, isNext: false, progress: 0.4 });
  });

  it('resultado de outro episódio é ignorado; sem resultado a série fica na fila', () => {
    const eps = [
      watched('a6', 'A', '2026-10-01T00:00:00Z'),
      watched('b1', 'B', '2026-10-02T00:00:00Z'),
    ];
    const states: Record<string, NextState> = {
      A: { forEpisodeId: 'a5', next: null, checkedAt: now }, // velho: o último visto agora é a6
    };
    const out = continueWatching(eps, 20, states);
    expect(out.map((c) => c.seriesId).sort()).toEqual(['A', 'B']);
    expect(out.every((c) => !c.isNext)).toBe(true);
  });

  it('ordena pelo lançamento do próximo episódio', () => {
    const eps = [
      watched('a5', 'A', '2026-10-01T00:00:00Z'),
      watched('b5', 'B', '2026-10-02T00:00:00Z'),
    ];
    const states: Record<string, NextState> = {
      A: {
        forEpisodeId: 'a5',
        next: { ...nextEp, episodeId: 'an', releasedAt: '2026-10-09T00:00:00Z' },
        checkedAt: now,
      },
      B: {
        forEpisodeId: 'b5',
        next: { ...nextEp, episodeId: 'bn', releasedAt: '2026-09-01T00:00:00Z' },
        checkedAt: now,
      },
    };
    expect(continueWatching(eps, 20, states).map((c) => c.seriesId)).toEqual(['A', 'B']);
  });

  it('isWatched e latestPerSeries', () => {
    expect(isWatched(watched('x', 'X', '2026-10-01T00:00:00Z', { progress: null }))).toBe(true);
    expect(isWatched(watched('x', 'X', '2026-10-01T00:00:00Z', { progress: 0.89 }))).toBe(false);
    expect(isWatched(watched('x', 'X', '2026-10-01T00:00:00Z', { progress: 0.9 }))).toBe(true);
    const l = latestPerSeries([
      watched('a1', 'A', '2026-10-01T00:00:00Z'),
      watched('a2', 'A', '2026-10-03T00:00:00Z'),
      watched('b1', 'B', '2026-10-02T00:00:00Z'),
    ]);
    expect(l.map((e) => e.episodeId)).toEqual(['a2', 'b1']);
  });

  it('o histórico traz temporada e posição do episódio', () => {
    const e = normalizeHistoryItem({
      date_played: '2026-10-01T00:00:00Z',
      panel: {
        id: 'p',
        title: 'T',
        episode_metadata: {
          series_id: 'S',
          series_title: 'S',
          episode_number: 7,
          season_id: 'SE1',
          season_number: 2,
          sequence_number: 19,
        },
        images: {},
      },
    })!;
    expect(e).toMatchObject({ seasonId: 'SE1', seasonNumber: 2, sequence: 19 });
  });
});
