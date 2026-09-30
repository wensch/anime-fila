import { Browser } from '@capacitor/browser';
import { CapacitorHttp } from '@capacitor/core';
import { Injectable, inject, signal } from '@angular/core';
import { BUILD_NUMBER } from './build-info';
import { DiagnosticsService } from './diagnostics.service';
import { APK_URL, RELEASE_API, isNewer, parseBuildNumber } from './update';

/** Avisa quando há um APK mais novo na release e abre o download. */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly diag = inject(DiagnosticsService);

  readonly currentBuild = BUILD_NUMBER;
  /** Build disponível na release quando é mais novo que o instalado; senão null. */
  readonly available = signal<number | null>(null);
  /** Link real do APK informado pela release (com reserva no link fixo). */
  private downloadUrl: string | null = null;
  readonly checking = signal(false);
  /** Resultado da última checagem manual, para mostrar ao usuário. */
  readonly lastResult = signal<string | null>(null);

  async check(): Promise<void> {
    if (this.currentBuild <= 0) {
      this.lastResult.set('Build local: sem checagem de atualização.');
      return;
    }
    this.checking.set(true);
    try {
      const res = await CapacitorHttp.request({
        url: RELEASE_API,
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json' },
        connectTimeout: 10000,
        readTimeout: 15000,
      });
      const remote = res.status === 200 ? parseBuildNumber(res.data?.body) : null;
      const asset = (res.data?.assets ?? []).find((a: any) => /\.apk$/i.test(a?.name ?? ''));
      this.downloadUrl = asset?.browser_download_url ?? null;
      this.diag.log(`atualização: instalado #${this.currentBuild}, disponível #${remote ?? '?'} (HTTP ${res.status})`);
      if (isNewer(remote, this.currentBuild)) {
        this.available.set(remote);
        this.lastResult.set(`Nova versão disponível: #${remote}.`);
      } else {
        this.available.set(null);
        this.lastResult.set(res.status === 200 ? 'Você está na versão mais recente.' : `Não foi possível checar (HTTP ${res.status}).`);
      }
    } catch (e) {
      this.diag.log(`atualização: falha ao checar (${(e as Error).message})`);
      this.lastResult.set('Não foi possível checar atualizações agora.');
    } finally {
      this.checking.set(false);
    }
  }

  /** Abre o download do APK; ao terminar, toque na notificação para instalar. */
  async download(): Promise<void> {
    await Browser.open({ url: this.downloadUrl ?? APK_URL });
  }

  dismiss(): void {
    this.available.set(null);
  }
}
