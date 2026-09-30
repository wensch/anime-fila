import { Injectable, signal } from '@angular/core';
import { ApiConfig, DEFAULT_CONFIG, DEFAULT_MAX_EPISODES, EPISODE_LIMITS } from './endpoints';

export interface Session {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
  accountId: string | null;
}

const KEY = 'crunchysync.v2';

interface Stored {
  session: Session | null;
  config: ApiConfig;
  deviceId: string;
  maxEpisodes: number;
}

function load(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (parsed) {
      return {
        session: parsed.session ?? null,
        config: { ...DEFAULT_CONFIG, ...parsed.config },
        deviceId: parsed.deviceId || crypto.randomUUID(),
        maxEpisodes: EPISODE_LIMITS.includes(parsed.maxEpisodes) ? parsed.maxEpisodes : DEFAULT_MAX_EPISODES,
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

  setMaxEpisodes(n: number): void {
    this.maxEpisodes.set(n);
    this.persist();
  }

  resetConfig(): void {
    this.setConfig({ ...DEFAULT_CONFIG });
  }

  private persist(): void {
    try {
      const data: Stored = {
        session: this.session(),
        config: this.config(),
        deviceId: this.deviceId,
        maxEpisodes: this.maxEpisodes(),
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* sem armazenamento: a sessão vale só até fechar o app */
    }
  }
}
