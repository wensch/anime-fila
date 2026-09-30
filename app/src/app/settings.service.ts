import { Injectable, signal } from '@angular/core';
import { ApiConfig, DEFAULT_CONFIG } from './endpoints';

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
  accountId: string | null;
}

const KEY = 'crunchysync.v2';

interface Stored {
  session: Session | null;
  config: ApiConfig;
  deviceId: string;
}

function load(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (parsed) {
      return {
        session: parsed.session ?? null,
        config: { ...DEFAULT_CONFIG, ...parsed.config },
        deviceId: parsed.deviceId || crypto.randomUUID(),
      };
    }
  } catch {
    /* armazenamento indisponível ou corrompido */
  }
  return { session: null, config: { ...DEFAULT_CONFIG }, deviceId: crypto.randomUUID() };
}

/**
 * Guarda no aparelho a sessão (tokens) e a configuração da API.
 * A senha NUNCA é armazenada: só é usada no momento do login.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly initial = load();
  readonly session = signal<Session | null>(this.initial.session);
  readonly config = signal<ApiConfig>(this.initial.config);
  readonly deviceId = this.initial.deviceId;

  setSession(session: Session | null): void {
    this.session.set(session);
    this.persist();
  }

  setConfig(config: ApiConfig): void {
    this.config.set(config);
    this.persist();
  }

  resetConfig(): void {
    this.setConfig({ ...DEFAULT_CONFIG });
  }

  private persist(): void {
    try {
      const data: Stored = { session: this.session(), config: this.config(), deviceId: this.deviceId };
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* sem armazenamento: a sessão vale só até fechar o app */
    }
  }
}
