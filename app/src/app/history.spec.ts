import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  coverageGap,
  coverageStart,
  filterEpisodes,
  filterSeries,
  groupBySeries,
  mergeArchive,
  normalizeHistoryItem,
  slimForStorage,
  episodesOfSeries,
  extractSeriesCovers,
  pickLargestImage,
  pickSeriesCover,
} from './history';
import { Episode } from './models';

const raw = (id: string, seriesId: string, played: string | null, num = 1) => ({
  date_played: played,
  panel: {
    id,
    title: `Ep ${id}`,
    episode_metadata: {
      series_id: seriesId,
      series_title: `Série ${seriesId}`,
      episode_number: num,
    },
    images: {
      thumbnail: [
        [
          { width: 320, source: `small-${id}` },
          { width: 1280, source: `big-${id}` },
        ],
      ],
    },
  },
});
const ep = (
  id: string,
  seriesId: string,
  played: string | null,
  num: number | null = 1,
): Episode => ({
  episodeId: id,
  seriesId,
  seriesTitle: `Série ${seriesId}`,
  episodeTitle: `Ep ${id}`,
  episodeNumber: num,
  coverUrl: null,
  watchedAt: played,
});

describe('normalização', () => {
  it('escolhe a maior imagem', () => {
    expect(pickLargestImage(raw('a', 's', null).panel.images)).toBe('big-a');
    expect(pickLargestImage(undefined)).toBeNull();
  });
  it('ignora itens sem série e lê o número do episódio', () => {
    expect(normalizeHistoryItem({ panel: { id: 'filme' } })).toBeNull();
    expect(normalizeHistoryItem(raw('e1', 'S', null, 7))?.episodeNumber).toBe(7);
  });
});

describe('groupBySeries', () => {
  it('consolida 12 episódios em 1 série', () => {
    const eps = Array.from({ length: 12 }, (_, i) =>
      normalizeHistoryItem(
        raw(`e${i}`, 'S1', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
      )!,
    );
    const out = groupBySeries(eps);
    expect(out).toHaveLength(1);
    expect(out[0].episodeIds).toHaveLength(12);
    expect(out[0].coverUrl).toBe('big-e11');
  });
  it('ordena pela mais recente', () => {
    const out = groupBySeries([
      ep('a1', 'A', '2026-01-01T12:00:00Z'),
      ep('b1', 'B', '2026-03-01T12:00:00Z'),
      ep('a2', 'A', '2026-02-01T12:00:00Z'),
    ]);
    expect(out.map((s) => s.seriesId)).toEqual(['B', 'A']);
  });
});

describe('filtros', () => {
  const eps = [
    ep('1', 'A', '2026-01-10T12:00:00', 1),
    ep('2', 'A', '2026-01-20T12:00:00', 2),
    ep('3', 'B', '2026-02-05T12:00:00', 10),
    ep('4', 'B', null, null),
  ];
  it('por texto sem acento e caixa', () => {
    const e = [{ ...eps[0], seriesTitle: 'Sōsō no Frieren', episodeTitle: 'Aventura' }];
    expect(filterEpisodes(e, { ...EMPTY_FILTERS, query: 'soso' })).toHaveLength(1);
    expect(filterEpisodes(e, { ...EMPTY_FILTERS, query: 'AVENTURA' })).toHaveLength(1);
    expect(filterEpisodes(e, { ...EMPTY_FILTERS, query: 'xyz' })).toHaveLength(0);
  });
  it('por data inclui o dia final inteiro', () => {
    const r = filterEpisodes(eps, { ...EMPTY_FILTERS, from: '2026-01-20', to: '2026-02-05' });
    expect(r.map((e) => e.episodeId)).toEqual(['3', '2']);
  });
  it('ordena do mais recente ao mais antigo, sem data por último', () => {
    expect(filterEpisodes(eps, EMPTY_FILTERS).map((e) => e.episodeId)).toEqual([
      '3',
      '2',
      '1',
      '4',
    ]);
  });
  it('filtro de data exclui episódios sem data', () => {
    expect(
      filterEpisodes(eps, { ...EMPTY_FILTERS, from: '2020-01-01' }).map((e) => e.episodeId),
    ).not.toContain('4');
  });
  it('por número do episódio', () => {
    expect(
      filterEpisodes(eps, { ...EMPTY_FILTERS, epMin: 2, epMax: 10 }).map((e) => e.episodeId),
    ).toEqual(['3', '2']);
  });
  it('séries: filtro por data e ordenação', () => {
    const series = groupBySeries(eps);
    expect(
      filterSeries(series, { ...EMPTY_FILTERS, to: '2026-01-31' }, 'recent').map((s) => s.seriesId),
    ).toEqual(['A']);
    expect(filterSeries(series, EMPTY_FILTERS, 'title').map((s) => s.seriesId)).toEqual(['A', 'B']);
    expect(filterSeries(series, EMPTY_FILTERS, 'oldest').map((s) => s.seriesId)).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('capas de série', () => {
  const img = (w: number) => ({ width: w, source: `w${w}` });
  it('prefere poster_wide e o menor tamanho >= 640', () => {
    const images = {
      poster_wide: [[img(320), img(1920), img(800), img(640)]],
      poster_tall: [[img(1000)]],
    };
    expect(pickSeriesCover(images)).toBe('w640');
  });
  it('cai para poster_tall e para o maior disponível', () => {
    expect(pickSeriesCover({ poster_tall: [[img(200), img(400)]] })).toBe('w400');
    expect(pickSeriesCover({})).toBeNull();
  });
  it('extrai mapa id -> capa ignorando itens sem imagem', () => {
    const body = {
      data: [
        { id: 'A', images: { poster_wide: [[img(800)]] } },
        { id: 'B', images: {} },
        { images: {} },
      ],
    };
    expect(extractSeriesCovers(body)).toEqual({ A: 'w800' });
  });
});

describe('episodesOfSeries', () => {
  it('filtra pelas séries pedidas, mantendo a ordem', () => {
    const eps = [ep('1', 'A', null), ep('2', 'B', null), ep('3', 'A', null), ep('4', 'C', null)];
    expect(episodesOfSeries(eps, ['A', 'C']).map((e) => e.episodeId)).toEqual(['1', '3', '4']);
    expect(episodesOfSeries(eps, [])).toEqual([]);
  });
});

describe('filtro "sem assistir há X meses"', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const eps = [
    ep('novo', 'A', '2026-09-20T12:00:00Z'),
    ep('4m', 'B', '2026-05-20T12:00:00Z'),
    ep('8m', 'C', '2026-01-20T12:00:00Z'),
    ep('semdata', 'D', null),
  ];
  it('episódios: só os mais antigos que o corte; sem data ficam de fora', () => {
    const f = { ...EMPTY_FILTERS, olderThanMonths: 3 };
    expect(filterEpisodes(eps, f, now).map((e) => e.episodeId)).toEqual(['4m', '8m']);
    expect(
      filterEpisodes(eps, { ...EMPTY_FILTERS, olderThanMonths: 6 }, now).map((e) => e.episodeId),
    ).toEqual(['8m']);
    expect(filterEpisodes(eps, EMPTY_FILTERS, now)).toHaveLength(4);
  });
  it('séries: usa a última vez assistida', () => {
    const series = groupBySeries(eps);
    const out = filterSeries(series, { ...EMPTY_FILTERS, olderThanMonths: 3 }, 'oldest', now);
    expect(out.map((s) => s.seriesId)).toEqual(['C', 'B']);
  });
});

describe('filtro exato por série', () => {
  const eps = [
    ep('1', 'A', '2026-09-01T00:00:00Z'),
    { ...ep('2', 'B', '2026-09-02T00:00:00Z'), seriesTitle: 'Naruto Shippuden' },
    { ...ep('3', 'A', '2026-09-03T00:00:00Z'), seriesTitle: 'Naruto' },
  ];
  it('não mistura séries de títulos parecidos', () => {
    const out = filterEpisodes(eps, { ...EMPTY_FILTERS, seriesId: 'A' });
    expect(out.map((e) => e.episodeId)).toEqual(['3', '1']);
    expect(filterEpisodes(eps, { ...EMPTY_FILTERS, query: 'Naruto' })).toHaveLength(2);
  });
});

describe('filtro de datas (dia local, limites inclusivos)', () => {
  // Datas montadas no fuso local, para o teste valer em qualquer fuso do aparelho.
  const at = (y: number, m: number, d: number, h: number, min = 0) =>
    new Date(y, m - 1, d, h, min).toISOString();
  const eps = [
    ep('antes', 'A', at(2026, 3, 9, 23, 59)),
    ep('inicio', 'B', at(2026, 3, 10, 0, 0)),
    ep('meio', 'C', at(2026, 3, 15, 12)),
    ep('fim', 'D', at(2026, 3, 20, 23, 59)),
    ep('depois', 'E', at(2026, 3, 21, 0, 0)),
    ep('semdata', 'F', null),
  ];
  const ids = (f: Partial<typeof EMPTY_FILTERS>) =>
    filterEpisodes(eps, { ...EMPTY_FILTERS, ...f }).map((e) => e.episodeId);

  it('"de" e "até" incluem o próprio dia, do primeiro ao último minuto', () => {
    expect(ids({ from: '2026-03-10', to: '2026-03-20' })).toEqual(['fim', 'meio', 'inicio']);
  });
  it('só "de" ou só "até"', () => {
    expect(ids({ from: '2026-03-20' })).toEqual(['depois', 'fim']);
    expect(ids({ to: '2026-03-10' })).toEqual(['inicio', 'antes']);
  });
  it('um único dia (de = até)', () => {
    expect(ids({ from: '2026-03-15', to: '2026-03-15' })).toEqual(['meio']);
  });
  it('sem data nunca entra quando há filtro de data; sem filtro, entra', () => {
    expect(ids({ from: '2000-01-01' })).not.toContain('semdata');
    expect(ids({})).toContain('semdata');
  });
  it('valor inválido é ignorado', () => {
    expect(ids({ from: 'abc', to: '' })).toHaveLength(6);
  });
  it('séries: filtra pela última vez assistida', () => {
    const series = groupBySeries([
      ep('1', 'X', at(2026, 3, 1, 10)),
      ep('2', 'X', at(2026, 3, 18, 10)),
      ep('3', 'Y', at(2026, 3, 5, 10)),
    ]);
    const out = filterSeries(series, { ...EMPTY_FILTERS, from: '2026-03-10' }, 'recent');
    expect(out.map((x) => x.seriesId)).toEqual(['X']); // X foi vista de novo dia 18; Y parou dia 5
  });
});

describe('cobertura do histórico', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const eps = [ep('a', 'A', '2026-09-01T00:00:00Z'), ep('b', 'B', '2026-04-10T00:00:00Z')];
  it('começa no episódio mais antigo com data', () => {
    expect(coverageStart(eps)).toBe(Date.parse('2026-04-10T00:00:00Z'));
    expect(coverageStart([ep('x', 'X', null)])).toBeNull();
  });
  it('avisa só quando o filtro pede algo além do que se enxerga', () => {
    const f6 = { ...EMPTY_FILTERS, olderThanMonths: 6 }; // corte em 30/03: antes de 10/04
    expect(coverageGap(eps, true, f6, now)).toBe(Date.parse('2026-04-10T00:00:00Z'));
    expect(coverageGap(eps, false, f6, now)).toBeNull(); // histórico completo: sem aviso
    expect(coverageGap(eps, true, { ...EMPTY_FILTERS, olderThanMonths: 3 }, now)).toBeNull();
    expect(coverageGap(eps, true, { ...EMPTY_FILTERS, from: '2026-01-01' }, now)).not.toBeNull();
    expect(coverageGap(eps, true, { ...EMPTY_FILTERS, from: '2026-08-01' }, now)).toBeNull();
  });
});

describe('histórico acumulado (mergeArchive)', () => {
  const fresh = [ep('n2', 'A', '2026-09-20T00:00:00Z'), ep('n1', 'A', '2026-09-10T00:00:00Z')];
  const archive = [
    ep('n2', 'A', '2026-09-20T00:00:00Z'),
    ep('apagado', 'B', '2026-09-15T00:00:00Z'), // mais novo que o mais antigo atual e sumiu: apagado fora
    ep('velho1', 'C', '2026-08-01T00:00:00Z'), // além da janela: continua guardado
    ep('velho2', 'C', '2026-07-01T00:00:00Z'),
    ep('semdata', 'D', null),
  ];
  it('sem mayHaveMore o resultado atual é o histórico inteiro', () => {
    expect(mergeArchive(fresh, archive, false, 100)).toEqual(fresh);
  });
  it('guarda o que saiu da janela e descarta o que foi apagado em outro lugar', () => {
    const out = mergeArchive(fresh, archive, true, 100).map((e) => e.episodeId);
    expect(out).toEqual(['n2', 'n1', 'velho1', 'velho2']);
  });
  it('respeita o limite, mantendo os mais recentes', () => {
    expect(mergeArchive(fresh, archive, true, 3).map((e) => e.episodeId)).toEqual([
      'n2',
      'n1',
      'velho1',
    ]);
  });
});

describe('slimForStorage', () => {
  it('mantém a miniatura só no primeiro episódio de cada série', () => {
    const e = (id: string, sid: string) => ({ ...ep(id, sid, null), coverUrl: 'http://x/' + id });
    const out = slimForStorage([e('1', 'A'), e('2', 'A'), e('3', 'B')]);
    expect(out.map((x) => x.coverUrl)).toEqual(['http://x/1', null, 'http://x/3']);
  });
});
