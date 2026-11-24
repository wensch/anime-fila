import { ContinueItem, pickLargestImage } from './history';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Lista "Continuar assistindo" da própria Crunchyroll (/content/v2/discover/{conta}/watchlist):
 * cada item traz o PRÓXIMO episódio a assistir, e quem terminou a série já vem marcado.
 * Devolve null se a resposta não tem o formato esperado (quem chama usa o histórico no lugar);
 * uma lista vazia é um resultado válido ("nada para continuar").
 *
 * Fica de fora: séries sem episódio (só salvas na lista), filmes, séries em dia ou terminadas
 * (`fully_watched`) e as que você nunca começou (`never_watched`).
 * Ordem: lançamento do episódio, o mais novo primeiro.
 */
export function normalizeWatchlist(body: any): ContinueItem[] | null {
  const data = body?.data;
  if (!Array.isArray(data)) return null;
  const seen = new Set<string>();
  const out: ContinueItem[] = [];
  for (const raw of data) {
    const panel = raw?.panel;
    const meta = panel?.episode_metadata;
    if (!panel?.id || !meta?.series_id) continue;
    if (raw.fully_watched === true || raw.never_watched === true) continue;
    if (seen.has(meta.series_id)) continue;
    seen.add(meta.series_id);
    const released: string | null =
      meta.premium_available_date ?? meta.episode_air_date ?? meta.availability_starts ?? null;
    const total = Number(meta.duration_ms) / 1000;
    const played = Number(raw.playhead);
    const progress =
      Number.isFinite(played) && played > 0 && total > 0 ? Math.min(1, played / total) : null;
    out.push({
      seriesId: meta.series_id,
      seriesTitle: meta.series_title ?? panel.title ?? 'Sem título',
      episodeId: panel.id,
      episodeNumber: num(meta.episode_number ?? meta.episode),
      episodeTitle: panel.title ?? null,
      coverUrl: pickLargestImage(panel.images),
      releasedAt: released,
      hasRelease: Number.isNaN(Date.parse(released ?? '')) ? false : true,
      watchedAt: raw.date_played ?? null,
      progress,
      isNext: progress === null,
    });
  }
  const t = (iso: string | null) =>
    Number.isNaN(Date.parse(iso ?? '')) ? 0 : Date.parse(iso ?? '');
  return out.sort((a, b) => t(b.releasedAt) - t(a.releasedAt));
}
