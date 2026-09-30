import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Sem plataforma nativa: o serviço usa CapacitorHttp, que aqui é simulado.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));

import { CapacitorHttp } from '@capacitor/core';
import { ApiError, CrunchyrollService, SessionExpiredError } from './crunchyroll.service';
import { DiagnosticsService } from './diagnostics.service';
import { SettingsService } from './settings.service';

const request = CapacitorHttp.request as unknown as ReturnType<typeof vi.fn>;

class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

const item = (id: string, sid = 'S1') => ({
  date_played: '2026-09-01T00:00:00Z',
  panel: {
    id,
    title: id,
    episode_metadata: { series_id: sid, series_title: sid, episode_number: 1 },
    images: {},
  },
});
const ok = (data: unknown, status = 200) => ({ status, data });

function setup() {
  (globalThis as any).localStorage = new MemoryStorage();
  const injector = Injector.create({
    providers: [
      { provide: SettingsService, useClass: SettingsService, deps: [] },
      { provide: DiagnosticsService, useClass: DiagnosticsService, deps: [] },
      { provide: CrunchyrollService, useClass: CrunchyrollService, deps: [] },
    ],
  });
  const settings = injector.get(SettingsService);
  settings.setSession({ accessToken: 'tok', expiresAt: Date.now() + 3_600_000, accountId: 'acc' });
  return { cr: injector.get(CrunchyrollService), settings };
}

const path = (call: unknown[]) => new URL((call[0] as { url: string }).url).pathname;
const method = (call: unknown[]) => (call[0] as { method: string }).method;

beforeEach(() => {
  request.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('listHistory', () => {
  it('pagina até uma página incompleta e remove repetidos', async () => {
    const { cr } = setup();
    const page1 = Array.from({ length: 100 }, (_, i) => item('e' + i));
    const page2 = [item('e99'), ...Array.from({ length: 20 }, (_, i) => item('x' + i))]; // e99 repete
    request.mockResolvedValueOnce(ok({ data: page1 })).mockResolvedValueOnce(ok({ data: page2 }));
    const eps = await cr.listHistory(500);
    expect(eps).toHaveLength(120);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('respeita o limite pedido', async () => {
    const { cr } = setup();
    request.mockResolvedValue(
      ok({ data: Array.from({ length: 100 }, (_, i) => item('e' + i + Math.random())) }),
    );
    expect(await cr.listHistory(100)).toHaveLength(100);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('autenticação e tentativas', () => {
  it('no 401 renova o token pelo cookie e repete a chamada', async () => {
    const { cr, settings } = setup();
    request.mockImplementation(async (opts: { url: string; headers: Record<string, string> }) => {
      const p = new URL(opts.url).pathname;
      if (p === '/auth/v1/token')
        return ok({ access_token: 'novo', expires_in: 300, account_id: 'acc' });
      return opts.headers['Authorization'] === 'Bearer novo'
        ? ok({ data: [item('a')] })
        : ok({}, 401);
    });
    const eps = await cr.listHistory(10);
    expect(eps).toHaveLength(1);
    expect(settings.session()?.accessToken).toBe('novo');
    expect(request.mock.calls.filter((c) => path(c) === '/auth/v1/token')).toHaveLength(1);
  });

  it('401 persistente encerra a sessão', async () => {
    const { cr, settings } = setup();
    request.mockImplementation(async (opts: { url: string }) =>
      new URL(opts.url).pathname === '/auth/v1/token'
        ? ok({ access_token: 'x', expires_in: 300 })
        : ok({}, 401),
    );
    await expect(cr.listHistory(10)).rejects.toBeInstanceOf(SessionExpiredError);
    expect(settings.session()).toBeNull();
  });

  it('429 espera e tenta de novo; esgotadas as tentativas vira erro', async () => {
    vi.useFakeTimers();
    const { cr } = setup();
    request.mockResolvedValueOnce(ok({}, 429)).mockResolvedValueOnce(ok({ data: [item('a')] }));
    const p = cr.listHistory(10);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toHaveLength(1);

    request.mockReset();
    request.mockResolvedValue(ok({}, 503));
    const failing = cr.listHistory(10).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await failing;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect(request).toHaveBeenCalledTimes(4); // 1 + 3 tentativas
  });
});

describe('deleteEpisodes', () => {
  it('reporta progresso e separa sucessos de falhas', async () => {
    const { cr } = setup();
    request.mockImplementation(async (opts: { url: string }) =>
      new URL(opts.url).pathname.endsWith('/bad') ? ok({}, 404) : ok(null, 204),
    );
    const progress: number[] = [];
    const ids = ['a', 'b', 'c', 'bad', 'd', 'e', 'f'];
    const out = await cr.deleteEpisodes(ids, { onProgress: (d) => progress.push(d) });
    expect(out.deleted).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(out.failed.map((f) => f.id)).toEqual(['bad']);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(7);
    expect(request.mock.calls.every((c) => method(c) === 'DELETE')).toBe(true);
  });

  it('cancelar interrompe entre lotes', async () => {
    const { cr } = setup();
    request.mockResolvedValue(ok(null, 204));
    let cancel = false;
    const ids = Array.from({ length: 20 }, (_, i) => 'e' + i);
    const out = await cr.deleteEpisodes(ids, {
      onProgress: (done) => {
        if (done >= 5) cancel = true;
      },
      isCancelled: () => cancel,
    });
    expect(out.cancelled).toBe(true);
    expect(out.deleted).toHaveLength(5); // só o primeiro lote de 5
  });
});

describe('scanHistory (janela de 1000 da API)', () => {
  const full = (prefix: string) => Array.from({ length: 100 }, (_, i) => item(`${prefix}${i}`));

  it('página além da janela (400) encerra a leitura sem erro e marca capped', async () => {
    const { cr } = setup();
    request
      .mockResolvedValueOnce(ok({ data: full('a') }))
      .mockResolvedValueOnce(ok({ data: full('b') }))
      .mockResolvedValueOnce(ok({ error: 'format_validation_error' }, 400));
    const r = await cr.scanHistory(5000);
    expect(r.episodes).toHaveLength(200);
    expect(r.capped).toBe(true);
  });

  it('400 na primeira página continua sendo erro', async () => {
    const { cr } = setup();
    request.mockResolvedValue(ok({}, 400));
    await expect(cr.scanHistory(100)).rejects.toBeInstanceOf(ApiError);
  });

  it('capped só quando o limite é atingido; página curta = histórico completo', async () => {
    const { cr } = setup();
    request.mockResolvedValueOnce(ok({ data: full('a') }));
    expect((await cr.scanHistory(100)).capped).toBe(true);
    request.mockReset();
    request
      .mockResolvedValueOnce(ok({ data: full('a') }))
      .mockResolvedValueOnce(ok({ data: [item('z')] }));
    const r = await cr.scanHistory(500);
    expect(r.episodes).toHaveLength(101);
    expect(r.capped).toBe(false);
  });
});
