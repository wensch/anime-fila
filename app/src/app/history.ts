import { Episode, Series } from './models';

/** Maior imagem de `images.thumbnail` (array de arrays de {width, source}). */
export function pickLargestImage(images: any): string | null {
  const sets: any[][] = images?.thumbnail ?? images?.poster_tall ?? [];
  let best: { width?: number; source: string } | null = null;
  for (const variants of sets) {
    for (const img of variants ?? []) {
      if (img?.source && (!best || (img.width ?? 0) > (best.width ?? 0))) best = img;
    }
  }
  return best?.source ?? null;
}

/** Item bruto do watch-history da Crunchyroll -> Episode. Itens sem série (filmes) viram null. */
export function normalizeHistoryItem(raw: any): Episode | null {
  const panel = raw?.panel ?? {};
  const meta = panel.episode_metadata ?? {};
  const episodeId = panel.id ?? raw?.id;
  if (!episodeId || !meta.series_id) return null;
  const num = Number(meta.episode_number ?? meta.episode);
  return {
    episodeId,
    seriesId: meta.series_id,
    seriesTitle: meta.series_title ?? panel.title ?? 'Sem título',
    episodeTitle: panel.title ?? null,
    episodeNumber: Number.isFinite(num) ? num : null,
    coverUrl: pickLargestImage(panel.images),
    watchedAt: raw?.date_played ?? null,
  };
}

const time = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? 0 : t;
};

/** reduce() por series_id: uma entrada por série, mais recentes primeiro. */
export function groupBySeries(episodes: Episode[]): Series[] {
  const map = episodes.reduce((acc, ep) => {
    let s = acc.get(ep.seriesId);
    if (!s) {
      s = {
        seriesId: ep.seriesId,
        title: ep.seriesTitle,
        coverUrl: ep.coverUrl,
        episodeCount: 0,
        lastWatchedAt: null,
        episodeIds: [],
      };
      acc.set(ep.seriesId, s);
    }
    s.episodeIds.push(ep.episodeId);
    s.episodeCount += 1;
    if (!s.coverUrl && ep.coverUrl) s.coverUrl = ep.coverUrl;
    if (time(ep.watchedAt) > time(s.lastWatchedAt)) {
      s.lastWatchedAt = ep.watchedAt;
      if (ep.coverUrl) s.coverUrl = ep.coverUrl;
    }
    return acc;
  }, new Map<string, Series>());
  return [...map.values()].sort((a, b) => time(b.lastWatchedAt) - time(a.lastWatchedAt));
}

export interface Filters {
  query: string;
  /** 'YYYY-MM-DD' (dia local) ou ''. */
  from: string;
  to: string;
  /** Só episódios: intervalo de número do episódio. */
  epMin: number | null;
  epMax: number | null;
}

export const EMPTY_FILTERS: Filters = { query: '', from: '', to: '', epMin: null, epMax: null };

function dayBounds(f: Filters): [number, number] {
  const parse = (s: string, end: boolean) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return end ? Infinity : -Infinity;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return end ? d.getTime() + 86_400_000 - 1 : d.getTime();
  };
  return [parse(f.from, false), parse(f.to, true)];
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function inRange(iso: string | null, lo: number, hi: number): boolean {
  if (lo === -Infinity && hi === Infinity) return true;
  const t = time(iso);
  return t !== 0 && t >= lo && t <= hi;
}

export function filterEpisodes(episodes: Episode[], f: Filters): Episode[] {
  const q = norm(f.query.trim());
  const [lo, hi] = dayBounds(f);
  const kept = episodes.filter((e) => {
    if (q && !norm(`${e.seriesTitle} ${e.episodeTitle ?? ''}`).includes(q)) return false;
    if (!inRange(e.watchedAt, lo, hi)) return false;
    if (f.epMin !== null && (e.episodeNumber === null || e.episodeNumber < f.epMin)) return false;
    if (f.epMax !== null && (e.episodeNumber === null || e.episodeNumber > f.epMax)) return false;
    return true;
  });
  // Mais recentes primeiro; sem data vai para o fim. sort() do JS é estável.
  return kept.sort((a, b) => time(b.watchedAt) - time(a.watchedAt));
}

export type SeriesSort = 'recent' | 'oldest' | 'title' | 'count';

export function filterSeries(series: Series[], f: Filters, sort: SeriesSort): Series[] {
  const q = norm(f.query.trim());
  const [lo, hi] = dayBounds(f);
  const out = series.filter(
    (s) => (!q || norm(s.title).includes(q)) && inRange(s.lastWatchedAt, lo, hi),
  );
  const by: Record<SeriesSort, (a: Series, b: Series) => number> = {
    recent: (a, b) => time(b.lastWatchedAt) - time(a.lastWatchedAt),
    oldest: (a, b) => time(a.lastWatchedAt) - time(b.lastWatchedAt),
    title: (a, b) => a.title.localeCompare(b.title, 'pt-BR'),
    count: (a, b) => b.episodeCount - a.episodeCount,
  };
  return out.sort(by[sort]);
}

/**
 * Capa oficial da série a partir de `images` do CMS: prefere poster_wide (16:9, como o card),
 * depois poster_tall; entre os tamanhos, o menor com largura >= 640px (senão o maior).
 */
export function pickSeriesCover(images: any): string | null {
  for (const key of ['poster_wide', 'poster_tall']) {
    const flat: { width?: number; source?: string }[] = (images?.[key] ?? []).flat();
    const valid = flat.filter((i) => i?.source);
    if (valid.length === 0) continue;
    const sorted = [...valid].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
    return (sorted.find((i) => (i.width ?? 0) >= 640) ?? sorted[sorted.length - 1]).source!;
  }
  return null;
}

/** Resposta de /cms/objects: itens do tipo série -> mapa seriesId -> URL da capa. */
export function extractSeriesCovers(body: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of body?.data ?? []) {
    const cover = item?.id ? pickSeriesCover(item.images) : null;
    if (cover) out[item.id] = cover;
  }
  return out;
}
