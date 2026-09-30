import { registerPlugin } from '@capacitor/core';

/** Ponte com o plugin Android `AppUpdater`: baixa o APK e abre o instalador do sistema. */
export interface AppUpdaterPlugin {
  /** Rejeita com code: NEEDS_PERMISSION | BUSY | DOWNLOAD | BAD_URL. */
  install(opts: { url: string }): Promise<void>;
  addListener(
    event: 'progress',
    fn: (d: { percent: number }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

export const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');
