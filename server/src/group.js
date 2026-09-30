/**
 * Transformação de dados: lista plana de episódios -> lista de séries.
 * Entrada: itens já normalizados por `normalizeHistoryItem`.
 */

/** Escolhe a maior imagem de `images.thumbnail` (array de arrays de {width, source}). */
export function pickLargestImage(images) {
  const sets = images?.thumbnail ?? images?.poster_tall ?? [];
  let best = null;
  for (const variants of sets) {
    for (const img of variants ?? []) {
      if (img?.source && (!best || (img.width ?? 0) > (best.width ?? 0))) best = img;
    }
  }
  return best?.source ?? null;
}

/** Converte um item bruto de watch-history da Crunchyroll no formato interno. */
export function normalizeHistoryItem(raw) {
  const panel = raw?.panel ?? {};
  const meta = panel.episode_metadata ?? {};
  const episodeId = panel.id ?? raw?.id;
  if (!episodeId || !meta.series_id) return null; // filmes/itens sem série são ignorados
  return {
    episodeId,
    seriesId: meta.series_id,
    seriesTitle: meta.series_title ?? panel.title ?? 'Sem título',
    episodeTitle: panel.title ?? null,
    episodeNumber: meta.episode_number ?? meta.episode ?? null,
    coverUrl: pickLargestImage(panel.images),
    watchedAt: raw?.date_played ?? null,
  };
}

const time = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? 0 : t;
};

/** reduce() por series_id -> um objeto consolidado por série, mais recentes primeiro. */
export function groupBySeries(items) {
  const bySeries = items.reduce((acc, ep) => {
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
      if (ep.coverUrl) s.coverUrl = ep.coverUrl; // capa do episódio mais recente
    }
    return acc;
  }, new Map());
  return [...bySeries.values()].sort((a, b) => time(b.lastWatchedAt) - time(a.lastWatchedAt));
}
