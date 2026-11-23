import type { ContinueItem } from './history';

/** Aparência do widget "Continuar assistindo": estilo e tamanho escolhidos pelo usuário. */
export const WIDGET_STYLES = ['carousel', 'list', 'hero'] as const;
export const WIDGET_SIZES = ['s', 'm', 'l'] as const;
export type WidgetStyle = (typeof WIDGET_STYLES)[number];
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export const DEFAULT_WIDGET_STYLE: WidgetStyle = 'carousel';
export const DEFAULT_WIDGET_SIZE: WidgetSize = 'm';

export const WIDGET_STYLE_LABEL: Record<WidgetStyle, string> = {
  carousel: 'Carrossel',
  list: 'Lista',
  hero: 'Destaque',
};
export const WIDGET_SIZE_LABEL: Record<WidgetSize, string> = {
  s: 'Pequeno',
  m: 'Médio',
  l: 'Grande',
};

export const isWidgetStyle = (v: unknown): v is WidgetStyle =>
  WIDGET_STYLES.includes(v as WidgetStyle);
export const isWidgetSize = (v: unknown): v is WidgetSize => WIDGET_SIZES.includes(v as WidgetSize);

/** Quantos itens cada combinação mostra (a lista cresce com o tamanho; as demais rolam). */
export function widgetCount(style: WidgetStyle, size: WidgetSize): number {
  if (style === 'list') return { s: 4, m: 6, l: 10 }[size];
  return 20;
}

/** Classes (completas, para o Tailwind encontrá-las) de cada estilo e tamanho. */
export const CAROUSEL_CARD: Record<WidgetSize, string> = {
  s: 'w-40',
  m: 'w-[15.5rem]',
  l: 'w-72',
};
export const LIST_THUMB: Record<WidgetSize, string> = {
  s: 'w-24',
  m: 'w-32',
  l: 'w-40',
};
export const HERO_SHAPE: Record<WidgetSize, string> = {
  s: 'aspect-[21/9]',
  m: 'aspect-video',
  l: 'aspect-[4/3]',
};
export const HERO_RAIL_CARD: Record<WidgetSize, string> = {
  s: 'w-32',
  m: 'w-40',
  l: 'w-48',
};

/** Item enviado ao plugin Android dos widgets da tela inicial. */
export interface WidgetPushItem {
  seriesId: string;
  title: string;
  /** "Ep. 9" ou vazio. */
  episode: string;
  /** Lançamento (ou, sem ele, quando foi assistido), em ms; null se desconhecido. */
  releasedAt: number | null;
  hasRelease: boolean;
  progress: number | null;
  coverUrl: string | null;
}

/** Quantos itens vão para os widgets da tela inicial (o maior layout mostra 5). */
export const WIDGET_PUSH_MAX = 10;

export function toWidgetPayload(items: ContinueItem[]): WidgetPushItem[] {
  return items.slice(0, WIDGET_PUSH_MAX).map((c) => {
    const t = Date.parse(c.releasedAt ?? '');
    return {
      seriesId: c.seriesId,
      title: c.seriesTitle,
      episode: c.episodeNumber !== null ? `Ep. ${c.episodeNumber}` : '',
      releasedAt: Number.isNaN(t) ? null : t,
      hasRelease: c.hasRelease,
      progress: c.progress,
      coverUrl: c.coverUrl,
    };
  });
}

/** `crunchysync://series/<id>` (toque num widget) -> id da série; qualquer outro endereço -> null. */
export function parseSeriesLink(url: string | null | undefined): string | null {
  const m = /^crunchysync:\/\/series\/([^/?#]+)/.exec(url ?? '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}
