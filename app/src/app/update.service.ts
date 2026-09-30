import { Browser } from '@capacitor/browser';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Injectable, inject, signal } from '@angular/core';
import { AppUpdater } from './app-updater';
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
  /** Progresso do download em % (null = sem download em andamento). */
  readonly progress = signal<number | null>(null);
  readonly downloadError = signal<string | null>(null);
  /** Resultado da última checagem manual, para mostrar ao usuário. */
  readonly lastResult = signal<string | null>(null);

  private lastCheckAt = 0;

  /** Checa ao voltar ao app, no máximo a cada 10 minutos e sem interromper um download. */
  async checkIfDue(): Promise<void> {
    if (this.progress() !== null || this.available() !== null) return;
    if (Date.now() - this.lastCheckAt < 10 * 60_000) return;
    await this.check();
  }

  async check(): Promise<void> {
    this.lastCheckAt = Date.now();
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
      this.diag.log(
        `atualização: instalado #${this.currentBuild}, disponível #${remote ?? '?'} (HTTP ${res.status})`,
      );
      if (isNewer(remote, this.currentBuild)) {
        this.available.set(remote);
        this.lastResult.set(`Nova versão disponível: #${remote}.`);
      } else {
        this.available.set(null);
        this.lastResult.set(
          res.status === 200
            ? 'Você está na versão mais recente.'
            : `Não foi possível checar (HTTP ${res.status}).`,
        );
      }
    } catch (e) {
      this.diag.log(`atualização: falha ao checar (${(e as Error).message})`);
      this.lastResult.set('Não foi possível checar atualizações agora.');
    } finally {
      this.checking.set(false);
    }
  }

  /** Baixa o APK dentro do app e abre o instalador do Android (uma confirmação do sistema). */
  async download(): Promise<void> {
    const url = this.downloadUrl ?? APK_URL;
    if (!Capacitor.isNativePlatform()) {
      await Browser.open({ url });
      this.dismiss();
      return;
    }
    this.downloadError.set(null);
    this.progress.set(0);
    const handle = await AppUpdater.addListener('progress', (d) => this.progress.set(d.percent));
    try {
      await AppUpdater.install({ url });
      this.dismiss();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      this.diag.log(`atualização: falha (${err.code ?? ''} ${err.message ?? ''})`);
      this.downloadError.set(
        err.code === 'NEEDS_PERMISSION'
          ? 'Ative "Permitir desta fonte" para o CrunchySync na tela que abriu, volte e toque em Atualizar de novo.'
          : 'Não foi possível baixar dentro do app. Você pode baixar pelo navegador.',
      );
    } finally {
      void handle.remove();
      this.progress.set(null);
    }
  }

  /** Reserva: abre o download no navegador. */
  async downloadInBrowser(): Promise<void> {
    await Browser.open({ url: this.downloadUrl ?? APK_URL });
  }

  dismiss(): void {
    this.available.set(null);
    this.downloadError.set(null);
  }
}
