import { registerPlugin } from '@capacitor/core';
import type { NextState } from './queue';
import type { WidgetPushItem, WidgetSyncConfig } from './widget';

/** Ponte com o plugin Android `HomeWidget`: alimenta os widgets da tela inicial. */
export interface HomeWidgetPlugin {
  /**
   * Guarda a lista, baixa as miniaturas e redesenha os widgets. Com `config`, o Android também
   * passa a atualizar a lista sozinho, em segundo plano (`next` só serve de ponto de partida).
   */
  update(opts: {
    items: WidgetPushItem[];
    config?: WidgetSyncConfig;
    next?: Record<string, NextState>;
  }): Promise<void>;
  /** Esvazia os widgets (ao sair da conta). */
  clear(): Promise<void>;
}

export const HomeWidget = registerPlugin<HomeWidgetPlugin>('HomeWidget');
