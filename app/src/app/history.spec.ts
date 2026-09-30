import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  filterEpisodes,
  filterSeries,
  groupBySeries,
  normalizeHistoryItem,
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
    episode_metadata: { series_id: seriesId, series_title: `Série ${seriesId}`, episode_number: num },
    images: { thumbnail: [[{ width: 320, source: `small-${id}` }, { width: 1280, source: `big-${id}` }]] },
  },
});
const ep = (id: string, seriesId: string, played: string | null, num: number | null = 1): Episode => ({
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
      normalizeHistoryItem(raw(`e${i}`, 'S1', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`))!,
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
    expect(filterEpisodes(eps, EMPTY_FILTERS).map((e) => e.episodeId)).toEqual(['3', '2', '1', '4']);
  });
  it('filtro de data exclui episódios sem data', () => {
    expect(filterEpisodes(eps, { ...EMPTY_FILTERS, from: '2020-01-01' }).map((e) => e.episodeId)).not.toContain('4');
  });
  it('por número do episódio', () => {
    expect(filterEpisodes(eps, { ...EMPTY_FILTERS, epMin: 2, epMax: 10 }).map((e) => e.episodeId)).toEqual(['3', '2']);
  });
  it('séries: filtro por data e ordenação', () => {
    const series = groupBySeries(eps);
    expect(filterSeries(series, { ...EMPTY_FILTERS, to: '2026-01-31' }, 'recent').map((s) => s.seriesId)).toEqual(['A']);
    expect(filterSeries(series, EMPTY_FILTERS, 'title').map((s) => s.seriesId)).toEqual(['A', 'B']);
    expect(filterSeries(series, EMPTY_FILTERS, 'oldest').map((s) => s.seriesId)).toEqual(['A', 'B']);
  });
});

describe('capas de série', () => {
  const img = (w: number) => ({ width: w, source: `w${w}` });
  it('prefere poster_wide e o menor tamanho >= 640', () => {
    const images = { poster_wide: [[img(320), img(1920), img(800), img(640)]], poster_tall: [[img(1000)]] };
    expect(pickSeriesCover(images)).toBe('w640');
  });
  it('cai para poster_tall e para o maior disponível', () => {
    expect(pickSeriesCover({ poster_tall: [[img(200), img(400)]] })).toBe('w400');
    expect(pickSeriesCover({})).toBeNull();
  });
  it('extrai mapa id -> capa ignorando itens sem imagem', () => {
    const body = { data: [{ id: 'A', images: { poster_wide: [[img(800)]] } }, { id: 'B', images: {} }, { images: {} }] };
    expect(extractSeriesCovers(body)).toEqual({ A: 'w800' });
  });
});
