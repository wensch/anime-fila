import { registerPlugin } from '@capacitor/core';

/** Ponte com o plugin Android `ExternalLink`: abre um episódio no aplicativo da Crunchyroll. */
export interface ExternalLinkPlugin {
  /** Abre o episódio no app da Crunchyroll; sem o app instalado, abre no navegador. */
  openEpisode(opts: { episodeId: string }): Promise<{ app: boolean }>;
}

export const ExternalLink = registerPlugin<ExternalLinkPlugin>('ExternalLink');

/** Endereço do episódio no site; o app da Crunchyroll reconhece esse mesmo link. */
export function episodeUrl(episodeId: string): string {
  return `https://www.crunchyroll.com/watch/${encodeURIComponent(episodeId)}`;
}
