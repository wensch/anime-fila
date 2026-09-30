import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Series } from './series.model';
import { SettingsService } from './settings.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  private readonly api = inject(ApiService);
  protected readonly settings = inject(SettingsService);

  protected readonly series = signal<Series[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly showSettings = signal(!this.settings.token());
  protected readonly pendingRemoval = signal<Series | null>(null);
  protected readonly removing = signal(false);

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.series().filter((s) => s.title.toLowerCase().includes(q)) : this.series();
  });

  constructor() {
    if (this.settings.token()) void this.refresh();
  }

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.series.set(await this.api.listSeries());
    } catch (e) {
      this.error.set(this.describe(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected saveSettings(apiUrl: string, token: string): void {
    this.settings.save(apiUrl, token);
    this.showSettings.set(false);
    void this.refresh();
  }

  protected async confirmRemoval(): Promise<void> {
    const target = this.pendingRemoval();
    if (!target) return;
    this.removing.set(true);
    this.error.set(null);
    try {
      const res = await this.api.deleteSeries(target.seriesId);
      if (res.failed.length === 0) {
        this.series.update((list) => list.filter((s) => s.seriesId !== target.seriesId));
        this.notice.set(`"${target.title}" removida (${res.deleted} episódios).`);
      } else {
        this.notice.set(
          `${res.deleted} de ${res.requested} episódios removidos; ${res.failed.length} falharam. Tente novamente.`,
        );
        await this.refresh();
      }
    } catch (e) {
      this.error.set(this.describe(e));
    } finally {
      this.removing.set(false);
      this.pendingRemoval.set(null);
    }
  }

  private describe(e: unknown): string {
    if (e instanceof HttpErrorResponse) {
      if (e.status === 0) return 'Não foi possível alcançar o servidor. Verifique a URL do BFF.';
      if (e.status === 401) return 'Token inválido ou expirado. Capture um novo token e salve nas configurações.';
      return e.error?.error ?? `Erro ${e.status} do servidor.`;
    }
    return 'Erro inesperado.';
  }
}
