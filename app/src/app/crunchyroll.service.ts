import { CapacitorHttp } from '@capacitor/core';
import { Injectable, inject } from '@angular/core';
import { DiagnosticsService } from './diagnostics.service';
import {
  AUTH_PATH,
  DELETE_CONCURRENCY,
  MAX_PAGES,
  PAGE_SIZE,
  USER_AGENT,
} from './endpoints';
import { normalizeHistoryItem } from './history';
import { DeleteOutcome, Episode } from './models';
import { Session, SettingsService } from './settings.service';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A sessão expirou e não deu para renová-la: o usuário precisa entrar de novo. */
export class SessionExpiredError extends Error {}

const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k]));

/** Resume um corpo de erro para o log sem vazar dados: só campos conhecidos, truncados. */
function summarizeError(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') return data.replace(/\s+/g, ' ').slice(0, 160);
  const d = data as Record<string, unknown>;
  const parts = [d['error'], d['error_description'], d['code'], d['message']].filter(
    (x) => typeof x === 'string',
  );
  return (parts.join(' | ') || JSON.stringify(Object.keys(d))).slice(0, 200);
}

/**
 * Cliente da Crunchyroll. Usa o HTTP nativo do Capacitor (sem CORS, IP residencial do
 * celular). No navegador de desenvolvimento cai para fetch e será barrado por CORS.
 */
@Injectable({ providedIn: 'root' })
export class CrunchyrollService {
  private readonly settings = inject(SettingsService);
  private readonly diag = inject(DiagnosticsService);

  private refreshing: Promise<Session> | null = null;

  get loggedIn(): boolean {
    return this.settings.session() !== null;
  }

  async login(email: string, password: string): Promise<void> {
    await this.requestToken({
      grant_type: 'password',
      username: email,
      password,
      scope: 'offline_access',
      device_id: this.settings.deviceId,
      device_name: 'CrunchySync',
      device_type: 'Android',
    });
  }

  logout(): void {
    this.settings.setSession(null);
  }

  async listHistory(): Promise<Episode[]> {
    const accountId = await this.accountId();
    const path = fill(this.settings.config().historyPath, { account: accountId });
    const episodes: Episode[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body: any = await this.authed('GET', path, {
        params: { page: String(page), page_size: String(PAGE_SIZE), locale: this.settings.config().locale },
      });
      const data: any[] = body?.data ?? [];
      for (const raw of data) {
        const ep = normalizeHistoryItem(raw);
        if (ep) episodes.push(ep);
      }
      const total = body?.total;
      if (data.length === 0 || data.length < PAGE_SIZE) break;
      if (typeof total === 'number' && page * PAGE_SIZE >= total) break;
    }
    return episodes;
  }

  /** Apaga em lotes paralelos; falhas individuais não interrompem o resto. */
  async deleteEpisodes(ids: string[]): Promise<DeleteOutcome> {
    const accountId = await this.accountId();
    const tpl = this.settings.config().deletePath;
    const out: DeleteOutcome = { deleted: [], failed: [] };
    for (let i = 0; i < ids.length; i += DELETE_CONCURRENCY) {
      const chunk = ids.slice(i, i + DELETE_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((id) => this.authed('DELETE', fill(tpl, { account: accountId, id }))),
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') out.deleted.push(chunk[idx]);
        else if (r.reason instanceof SessionExpiredError) throw r.reason;
        else out.failed.push({ id: chunk[idx], error: (r.reason as Error).message });
      });
    }
    return out;
  }

  // ---- internos ----

  private async accountId(): Promise<string> {
    const cached = this.settings.session()?.accountId;
    if (cached) return cached;
    const me: any = await this.authed('GET', this.settings.config().mePath);
    const id = me?.account_id;
    if (!id) throw new ApiError(502, 'Resposta de /me sem account_id');
    const s = this.settings.session();
    if (s) this.settings.setSession({ ...s, accountId: id });
    return id;
  }

  private async http(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: { headers?: Record<string, string>; params?: Record<string, string>; data?: unknown } = {},
  ) {
    const { baseUrl } = this.settings.config();
    let res;
    try {
      res = await CapacitorHttp.request({
        url: baseUrl + path,
        method,
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...opts.headers },
        params: opts.params,
        data: opts.data,
        connectTimeout: 15000,
        readTimeout: 30000,
      });
    } catch (e) {
      this.diag.log(`${method} ${path} -> FALHA DE REDE: ${(e as Error).message}`);
      throw new ApiError(0, 'Sem conexão com a Crunchyroll. Verifique sua internet.');
    }
    const ok = res.status >= 200 && res.status < 300;
    this.diag.log(`${method} ${path} -> ${res.status}${ok ? '' : ' ' + summarizeError(res.data)}`);
    return { ok, status: res.status, data: res.data };
  }

  private async requestToken(form: Record<string, string>): Promise<Session> {
    const res = await this.http('POST', AUTH_PATH, {
      headers: {
        Authorization: `Basic ${this.settings.config().basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: form,
    });
    if (!res.ok) {
      const bad = res.status === 400 || res.status === 401;
      throw new ApiError(
        res.status,
        bad && form['grant_type'] === 'password'
          ? 'E-mail ou senha incorretos (ou login bloqueado). Veja o Diagnóstico.'
          : `Login recusado (${res.status}). Veja o Diagnóstico.`,
      );
    }
    const d = res.data ?? {};
    if (!d.access_token) throw new ApiError(502, 'Resposta de login sem access_token.');
    const session: Session = {
      accessToken: d.access_token,
      refreshToken: d.refresh_token ?? this.settings.session()?.refreshToken ?? '',
      expiresAt: Date.now() + (Number(d.expires_in) || 300) * 1000,
      accountId: d.account_id ?? this.settings.session()?.accountId ?? null,
    };
    this.settings.setSession(session);
    return session;
  }

  /** Renova o token; chamadas simultâneas compartilham a mesma renovação. */
  private refresh(): Promise<Session> {
    this.refreshing ??= (async () => {
      const current = this.settings.session();
      if (!current?.refreshToken) throw new SessionExpiredError('Sessão expirada');
      try {
        return await this.requestToken({
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
          scope: 'offline_access',
          device_id: this.settings.deviceId,
          device_name: 'CrunchySync',
          device_type: 'Android',
        });
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          this.settings.setSession(null);
          throw new SessionExpiredError('Sessão expirada');
        }
        throw e;
      }
    })().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async validToken(): Promise<string> {
    let s = this.settings.session();
    if (!s) throw new SessionExpiredError('Não autenticado');
    if (s.expiresAt - Date.now() < 60_000) s = await this.refresh();
    return s.accessToken;
  }

  private async authed(
    method: 'GET' | 'DELETE',
    path: string,
    opts: { params?: Record<string, string> } = {},
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.validToken();
      const res = await this.http(method, path, {
        headers: { Authorization: `Bearer ${token}` },
        params: opts.params,
      });
      if (res.ok) return res.data;
      if (res.status === 401 && attempt === 0) {
        await this.refresh();
        continue;
      }
      if (res.status === 401) {
        this.settings.setSession(null);
        throw new SessionExpiredError('Sessão expirada');
      }
      throw new ApiError(res.status, `Crunchyroll respondeu ${res.status} em ${method} ${path}`);
    }
    throw new ApiError(500, 'Falha inesperada');
  }
}
