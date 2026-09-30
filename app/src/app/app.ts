import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ApiError, CrunchyrollService, SessionExpiredError } from './crunchyroll.service';
import { DiagnosticsService } from './diagnostics.service';
import { ApiConfig } from './endpoints';
import {
  EMPTY_FILTERS,
  Filters,
  SeriesSort,
  filterEpisodes,
  filterSeries,
  groupBySeries,
} from './history';
import { Episode, Series } from './models';
import { SettingsService } from './settings.service';

type Tab = 'series' | 'episodes';
type Pending =
  | { kind: 'series'; series: Series }
  | { kind: 'episodes'; ids: string[] };

const PAGE = 100;

@Component({
  selector: 'app-root',
  imports: [DatePipe],
  templateUrl: './app.html',
})
export class App {
  private readonly cr = inject(CrunchyrollService);
  protected readonly settings = inject(SettingsService);
  protected readonly diag = inject(DiagnosticsService);

  protected readonly loggedIn = computed(() => this.settings.session() !== null);
  protected readonly episodes = signal<Episode[]>([]);
  protected readonly loaded = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly loginBusy = signal(false);
  protected readonly loginError = signal<string | null>(null);

  protected readonly tab = signal<Tab>('series');
  protected readonly filters = signal<Filters>({ ...EMPTY_FILTERS });
  protected readonly sort = signal<SeriesSort>('recent');
  protected readonly limit = signal(PAGE);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly pending = signal<Pending | null>(null);
  protected readonly removing = signal(false);

  protected readonly showDiag = signal(false);
  protected readonly showAdvanced = signal(false);
  protected readonly copied = signal(false);

  protected readonly allSeries = computed(() => groupBySeries(this.episodes()));
  protected readonly visibleSeries = computed(() =>
    filterSeries(this.allSeries(), this.filters(), this.sort()),
  );
  protected readonly visibleEpisodes = computed(() => filterEpisodes(this.episodes(), this.filters()));
  protected readonly shownEpisodes = computed(() => this.visibleEpisodes().slice(0, this.limit()));
  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.query || f.from || f.to || f.epMin !== null || f.epMax !== null);
  });

  protected readonly pendingText = computed(() => {
    const p = this.pending();
    if (!p) return '';
    if (p.kind === 'series') {
      return `Todos os ${p.series.episodeCount} episódios de "${p.series.title}" serão apagados do histórico.`;
    }
    return `${p.ids.length} episódio(s) serão apagados do histórico.`;
  });

  constructor() {
    if (this.loggedIn()) void this.refresh();
  }

  // ---- sessão ----

  protected async login(email: string, password: string): Promise<void> {
    this.loginBusy.set(true);
    this.loginError.set(null);
    try {
      await this.cr.login(email.trim(), password);
      await this.refresh();
    } catch (e) {
      this.loginError.set(e instanceof Error ? e.message : 'Falha no login.');
    } finally {
      this.loginBusy.set(false);
    }
  }

  protected logout(): void {
    this.cr.logout();
    this.episodes.set([]);
    this.loaded.set(false);
    this.selected.set(new Set());
  }

  // ---- dados ----

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.episodes.set(await this.cr.listHistory());
      this.loaded.set(true);
      this.selected.set(new Set());
    } catch (e) {
      this.handleError(e);
    } finally {
      this.loading.set(false);
    }
  }

  protected async confirmRemoval(): Promise<void> {
    const p = this.pending();
    if (!p) return;
    const ids =
      p.kind === 'series' ? [...p.series.episodeIds] : p.ids;
    this.removing.set(true);
    this.error.set(null);
    try {
      const { deleted, failed } = await this.cr.deleteEpisodes(ids);
      const gone = new Set(deleted);
      this.episodes.update((list) => list.filter((e) => !gone.has(e.episodeId)));
      this.selected.update((s) => new Set([...s].filter((id) => !gone.has(id))));
      this.notice.set(
        failed.length
          ? `${deleted.length} de ${ids.length} removidos; ${failed.length} falharam. Veja o Diagnóstico.`
          : `${deleted.length} episódio(s) removido(s).`,
      );
    } catch (e) {
      this.handleError(e);
    } finally {
      this.removing.set(false);
      this.pending.set(null);
    }
  }

  // ---- filtros e seleção ----

  protected setFilter(patch: Partial<Filters>): void {
    this.filters.update((f) => ({ ...f, ...patch }));
    this.limit.set(PAGE);
  }

  protected setNumber(key: 'epMin' | 'epMax', raw: string): void {
    const n = raw.trim() === '' ? null : Number(raw);
    this.setFilter({ [key]: n !== null && Number.isFinite(n) ? n : null });
  }

  protected clearFilters(): void {
    this.filters.set({ ...EMPTY_FILTERS });
    this.limit.set(PAGE);
  }

  protected toggle(id: string): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected selectAllVisible(): void {
    this.selected.set(new Set(this.visibleEpisodes().map((e) => e.episodeId)));
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected removeSelected(): void {
    this.pending.set({ kind: 'episodes', ids: [...this.selected()] });
  }

  protected showSeriesEpisodes(title: string): void {
    this.clearFilters();
    this.setFilter({ query: title });
    this.tab.set('episodes');
  }

  // ---- configuração e diagnóstico ----

  protected saveConfig(values: Record<keyof ApiConfig, string>): void {
    this.settings.setConfig({ ...this.settings.config(), ...values });
    this.notice.set('Configurações salvas.');
  }

  protected async copyLog(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.diag.asText());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      /* sem permissão de clipboard: o usuário pode tirar print do log */
    }
  }

  private handleError(e: unknown): void {
    if (e instanceof SessionExpiredError) {
      this.episodes.set([]);
      this.loaded.set(false);
      this.loginError.set('Sua sessão expirou. Entre novamente.');
    } else if (e instanceof ApiError) {
      this.error.set(e.message);
    } else {
      this.error.set('Erro inesperado. Veja o Diagnóstico.');
    }
  }
}
