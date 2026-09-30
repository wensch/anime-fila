import { registerPlugin } from '@capacitor/core';

export interface PageFetchResult {
  status?: number;
  body?: string;
  error?: string;
}

/** Ponte com o plugin Android `PageFetch` (WebView com a página da Crunchyroll). */
export interface PageFetchPlugin {
  show(opts: { url?: string }): Promise<void>;
  hide(): Promise<void>;
  /** Rejeita com code 'CHALLENGE' se o Cloudflare não liberar a página a tempo. */
  ensureLoaded(opts: { url: string }): Promise<void>;
  fetch(opts: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<PageFetchResult>;
  addListener(
    event: 'pageFinished',
    fn: (data: { url: string }) => void,
  ): Promise<{ remove(): Promise<void> }>;
  addListener(event: 'closed', fn: () => void): Promise<{ remove(): Promise<void> }>;
}

export const PageFetch = registerPlugin<PageFetchPlugin>('PageFetch');
