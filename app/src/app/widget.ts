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
