import { registerPlugin } from '@capacitor/core';
import type { WidgetPushItem } from './widget';

/** Ponte com o plugin Android `HomeWidget`: alimenta os widgets da tela inicial. */
export interface HomeWidgetPlugin {
  /** Guarda a lista, baixa as miniaturas e redesenha os widgets. */
  update(opts: { items: WidgetPushItem[] }): Promise<void>;
  /** Esvazia os widgets (ao sair da conta). */
  clear(): Promise<void>;
}

export const HomeWidget = registerPlugin<HomeWidgetPlugin>('HomeWidget');
