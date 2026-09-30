import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Injectable, inject } from '@angular/core';
import { DiagnosticsService } from './diagnostics.service';
import { AUTH_PATH, DELETE_CONCURRENCY, MAX_PAGES, PAGE_SIZE } from './endpoints';
import { normalizeHistoryItem } from './history';
import { PageFetch } from './page-fetch';
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
 * Cliente da Crunchyroll. No APK, todas as chamadas saem de dentro de um WebView real com o
 * site aberto (plugin PageFetch), único jeito de passar pelo Cloudflare. No navegador de
 * desenvolvimento cai para fetch e será barrado por CORS.
 */
@Injectable({ providedIn: 'root' })
export class CrunchyrollService {
  private readonly settings = inject(SettingsService);
  private readonly diag = inject(DiagnosticsService);

  private refreshing: Promise<Session> | null = null;
  private readonly native = Capacitor.isNativePlatform();

  get loggedIn(): boolean {
    return this.settings.session() !== null;
  }

  /**
   * Login no site real, dentro de um WebView em tela cheia. O usuário digita e-mail e senha
   * na página da Crunchyroll (o app nunca os vê). Terminado o login, a sessão vem do cookie.
   */
  async login(): Promise<void> {
    if (!this.native) throw new ApiError(0, 'O login só funciona no aplicativo instalado (APK).');
    const base = this.settings.config().baseUrl;
    await PageFetch.show({ url: `${base}/login` });
    return new Promise<void>((resolve, reject) => {
      let trying = false;
      let finished = false;
      const handles: { remove(): Promise<void> }[] = [];
      const done = (err?: Error) => {
        finished = true;
        handles.forEach((h) => void h.remove());
        err ? reject(err) : resolve();
      };
      void PageFetch.addListener('pageFinished', async ({ url }) => {
        if (trying || finished || /\/(login|register|forgot|password)/.test(new URL(url).pathname)) return;
        trying = true;
        try {
          await this.requestToken();
          await PageFetch.hide();
          done();
        } catch {
          /* ainda sem sessão: o usuário continua no login */
        } finally {
          trying = false;
        }
      }).then((h) => handles.push(h));
      void PageFetch.addListener('closed', () => {
        if (!finished) done(new Error('Login cancelado.'));
      }).then((h) => handles.push(h));
    });
  }

  logout(): void {
    this.settings.setSession(null);
  }

  async listHistory(): Promise<Episode[]> {
    const accountId = await this.accountId();
    const path = fill(this.settings.config().historyPath, { account: accountId });
    const byId = new Map<string, Episode>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body: any = await this.authed('GET', path, {
        params: { page: String(page), page_size: String(PAGE_SIZE), locale: this.settings.config().locale },
      });
      const data: any[] = body?.data ?? [];
      const before = byId.size;
      for (const raw of data) {
        const ep = normalizeHistoryItem(raw);
        if (ep) byId.set(ep.episodeId, ep);
      }
      const total = body?.total;
      this.diag.log(
        `histórico p.${page}: ${data.length} itens, ${byId.size - before} novos, total=${total ?? '?'}`,
      );
      if (data.length === 0 || data.length < PAGE_SIZE) break;
      if (byId.size === before) break; // a API ignorou o número da página: evita laço
      if (typeof total === 'number' && page * PAGE_SIZE >= total) break;
    }
    const episodes = [...byId.values()];
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
    opts: { headers?: Record<string, string>; params?: Record<string, string>; data?: string } = {},
  ) {
    const { baseUrl } = this.settings.config();
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
    let status: number;
    let data: any;
    try {
      if (this.native) {
        // Vai de dentro do WebView com a página da Crunchyroll aberta (passa pelo Cloudflare).
        await PageFetch.ensureLoaded({ url: baseUrl + '/' });
        const r = await PageFetch.fetch({
          url: url.toString(),
          method,
          headers: { Accept: 'application/json', ...opts.headers },
          body: opts.data,
        });
        if (r.error) throw new Error(r.error);
        status = r.status ?? 0;
        try {
          data = r.body ? JSON.parse(r.body) : null;
        } catch {
          data = r.body ?? null;
        }
      } else {
        const r = await CapacitorHttp.request({
          url: url.toString(),
          method,
          headers: { Accept: 'application/json', ...opts.headers },
          data: opts.data,
          connectTimeout: 15000,
          readTimeout: 30000,
        });
        status = r.status;
        data = r.data;
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      this.diag.log(`${method} ${path} -> FALHA: ${code ?? ''} ${(e as Error).message}`);
      if (code === 'CHALLENGE') {
        throw new ApiError(403, 'A Crunchyroll pediu uma verificação. Toque em "Entrar" para concluí-la.');
      }
      throw new ApiError(0, 'Sem conexão com a Crunchyroll. Verifique sua internet.');
    }
    const ok = status >= 200 && status < 300;
    this.diag.log(`${method} ${path} -> ${status}${ok ? '' : ' ' + summarizeError(data)}`);
    return { ok, status, data };
  }

  /** Troca o cookie de sessão do site (etp_rt_cookie) por um access_token. */
  private async requestToken(): Promise<Session> {
    const form = new URLSearchParams({
      grant_type: 'etp_rt_cookie',
      scope: 'offline_access',
      device_id: this.settings.deviceId,
      device_type: 'Chrome on Android',
    });
    const res = await this.http('POST', AUTH_PATH, {
      headers: {
        Authorization: `Basic ${this.settings.config().basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: form.toString(),
    });
    if (!res.ok) {
      throw new ApiError(res.status, `Sessão não autorizada (${res.status}). Veja o Diagnóstico.`);
    }
    const d = res.data ?? {};
    if (!d.access_token) throw new ApiError(502, 'Resposta de login sem access_token.');
    const session: Session = {
      accessToken: d.access_token,
      expiresAt: Date.now() + (Number(d.expires_in) || 300) * 1000,
      accountId: d.account_id ?? this.settings.session()?.accountId ?? null,
    };
    this.settings.setSession(session);
    return session;
  }

  /** Renova o token pelo cookie; chamadas simultâneas compartilham a mesma renovação. */
  private refresh(): Promise<Session> {
    this.refreshing ??= (async () => {
      try {
        return await this.requestToken();
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 403) {
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
