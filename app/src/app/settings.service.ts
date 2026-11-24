import { Injectable, signal } from '@angular/core';
import { Episode } from './models';
import { ContinueItem, slimForStorage } from './history';
import type { NextState } from './queue';
import {
  DEFAULT_WIDGET_SIZE,
  DEFAULT_WIDGET_STYLE,
  WidgetSize,
  WidgetStyle,
  isWidgetSize,
  isWidgetStyle,
} from './widget';
import { ApiConfig, DEFAULT_CONFIG, DEFAULT_MAX_EPISODES, EPISODE_LIMITS } from './endpoints';

export interface Session {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
  accountId: string | null;
}

const KEY = 'crunchysync.v2';
const KEY_COVERS = 'crunchysync.covers';
const KEY_HISTORY = 'crunchysync.history';
const KEY_NEXT = 'crunchysync.next';
const KEY_QUEUE = 'crunchysync.queue';

interface Stored {
  session: Session | null;
  config: ApiConfig;
  deviceId: string;
  maxEpisodes: number;
  widgetStyle: WidgetStyle;
  widgetSize: WidgetSize;
}

function load(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (parsed) {
      return {
        session: parsed.session ?? null,
        config: { ...DEFAULT_CONFIG, ...parsed.config },
        deviceId: parsed.deviceId || crypto.randomUUID(),
        maxEpisodes: EPISODE_LIMITS.includes(parsed.maxEpisodes)
          ? parsed.maxEpisodes
          : DEFAULT_MAX_EPISODES,
        widgetStyle: isWidgetStyle(parsed.widgetStyle) ? parsed.widgetStyle : DEFAULT_WIDGET_STYLE,
        widgetSize: isWidgetSize(parsed.widgetSize) ? parsed.widgetSize : DEFAULT_WIDGET_SIZE,
      };
    }
  } catch {
    /* armazenamento indisponível ou corrompido */
  }
  return {
    session: null,
    config: { ...DEFAULT_CONFIG },
    deviceId: crypto.randomUUID(),
    maxEpisodes: DEFAULT_MAX_EPISODES,
    widgetStyle: DEFAULT_WIDGET_STYLE,
    widgetSize: DEFAULT_WIDGET_SIZE,
  };
}

/**
 * Guarda no aparelho a sessão (tokens) e a configuração da API.
 * A senha nunca passa pelo app: o login acontece na página da Crunchyroll.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly initial = load();
  readonly session = signal<Session | null>(this.initial.session);
  readonly config = signal<ApiConfig>(this.initial.config);
  readonly deviceId = this.initial.deviceId;
  /** Quantos episódios do histórico carregar (filtro "Carregar até"). */
  readonly maxEpisodes = signal(this.initial.maxEpisodes);

  setSession(session: Session | null): void {
    this.session.set(session);
    this.persist();
  }

  setConfig(config: ApiConfig): void {
    this.config.set(config);
    this.persist();
  }

  /** Cache seriesId -> URL da capa oficial (não é segredo; evita refazer as chamadas). */
  loadCovers(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(KEY_COVERS) ?? '{}') ?? {};
    } catch {
      return {};
    }
  }

  saveCovers(covers: Record<string, string>): void {
    try {
      localStorage.setItem(KEY_COVERS, JSON.stringify(covers));
    } catch {
      /* sem armazenamento: refaz na próxima abertura */
    }
  }

  /** Última lista de episódios carregada: mostrada na hora ao abrir, enquanto atualiza. */
  loadHistoryCache(): Episode[] {
    try {
      const v = JSON.parse(localStorage.getItem(KEY_HISTORY) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  saveHistoryCache(episodes: Episode[]): void {
    const slim = slimForStorage(episodes);
    try {
      localStorage.setItem(KEY_HISTORY, JSON.stringify(slim));
    } catch {
      try {
        // Sem espaço para tudo: guarda os mais recentes.
        localStorage.setItem(KEY_HISTORY, JSON.stringify(slim.slice(0, 2000)));
      } catch {
        /* sem armazenamento: abre sem cache */
      }
    }
  }

  clearHistoryCache(): void {
    try {
      localStorage.removeItem(KEY_HISTORY);
    } catch {
      /* ignora */
    }
  }

  /** Aparência do widget "Continuar assistindo". */
  readonly widgetStyle = signal<WidgetStyle>(this.initial.widgetStyle);
  readonly widgetSize = signal<WidgetSize>(this.initial.widgetSize);

  setWidgetStyle(v: WidgetStyle): void {
    this.widgetStyle.set(v);
    this.persist();
  }

  setWidgetSize(v: WidgetSize): void {
    this.widgetSize.set(v);
    this.persist();
  }

  /** Última fila "Continuar assistindo" da Crunchyroll: aparece na hora ao abrir, enquanto atualiza. */
  loadQueue(): ContinueItem[] | null {
    try {
      const v = JSON.parse(localStorage.getItem(KEY_QUEUE) ?? 'null');
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }

  saveQueue(items: ContinueItem[] | null): void {
    try {
      if (items === null) localStorage.removeItem(KEY_QUEUE);
      else localStorage.setItem(KEY_QUEUE, JSON.stringify(items));
    } catch {
      /* sem armazenamento: busca de novo na próxima abertura */
    }
  }

  /** Próximo episódio de cada série (fila "continuar assistindo"), guardado entre aberturas. */
  loadNext(): Record<string, NextState> {
    try {
      const v = JSON.parse(localStorage.getItem(KEY_NEXT) ?? '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }

  saveNext(next: Record<string, NextState>): void {
    try {
      localStorage.setItem(KEY_NEXT, JSON.stringify(next));
    } catch {
      /* sem armazenamento: busca de novo na próxima abertura */
    }
  }

  clearNext(): void {
    try {
      localStorage.removeItem(KEY_NEXT);
    } catch {
      /* ignora */
    }
  }

  setMaxEpisodes(n: number): void {
    this.maxEpisodes.set(n);
    this.persist();
  }

  resetConfig(): void {
    this.setConfig({ ...DEFAULT_CONFIG });
  }

  private persist(): void {
    try {
      // Só o que difere do padrão: assim, correções de padrão em versões futuras chegam a todos.
      const cfg = this.config();
      const overrides = Object.fromEntries(
        (Object.keys(DEFAULT_CONFIG) as (keyof ApiConfig)[])
          .filter((k) => cfg[k] !== DEFAULT_CONFIG[k])
          .map((k) => [k, cfg[k]]),
      );
      const data = {
        session: this.session(),
        config: overrides,
        deviceId: this.deviceId,
        maxEpisodes: this.maxEpisodes(),
        widgetStyle: this.widgetStyle(),
        widgetSize: this.widgetSize(),
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* sem armazenamento: a sessão vale só até fechar o app */
    }
  }
}
