import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { BackupService } from './backup.service';
import { ApiError, CrunchyrollService, SessionExpiredError } from './crunchyroll.service';
import { DiagnosticsService } from './diagnostics.service';
import { ApiConfig, EPISODE_LIMITS, FULL_SCAN_LIMIT, limitLabel } from './endpoints';
import {
  EMPTY_FILTERS,
  Filters,
  SeriesSort,
  episodesOfSeries,
  filterEpisodes,
  filterSeries,
  groupBySeries,
} from './history';
import { Episode } from './models';
import { SettingsService } from './settings.service';
import { UpdateService } from './update.service';

type Tab = 'series' | 'episodes';
/** O que será removido (já com os episódios exatos) e aguarda confirmação. */
interface Pending {
  kind: 'series' | 'episodes';
  episodes: Episode[];
  seriesCount: number;
  /** Episódios que existem no histórico mas não estavam na lista carregada. */
  extra: number;
}

const PAGE = 100;

@Component({
  selector: 'app-root',
  imports: [DatePipe],
  templateUrl: './app.html',
})
export class App {
  private readonly cr = inject(CrunchyrollService);
  private readonly backup = inject(BackupService);
  protected readonly settings = inject(SettingsService);
  protected readonly diag = inject(DiagnosticsService);
  protected readonly update = inject(UpdateService);

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
  protected readonly selectedSeries = signal<ReadonlySet<string>>(new Set());
  /** Modo "Selecionar várias" da aba Séries: só então as caixinhas aparecem. */
  protected readonly selectMode = signal(false);
  /** Conferindo o histórico completo antes de mostrar a confirmação de remoção de séries. */
  protected readonly scanning = signal(false);
  protected readonly removeProgress = signal<{ done: number; total: number } | null>(null);
  protected readonly cancelRequested = signal(false);
  protected readonly backupBusy = signal(false);
  protected readonly backedUp = signal(false);
  /** Verificação do Cloudflare pendente: mostra o botão para concluí-la. */
  protected readonly challenge = signal(false);

  protected readonly limits = EPISODE_LIMITS;
  protected readonly limitLabel = limitLabel;
  protected readonly staleOptions = [1, 3, 6, 12];
  protected readonly showDiag = signal(false);
  protected readonly showAdvanced = signal(false);
  protected readonly copied = signal(false);

  /** Capas oficiais por série (cache local + busca após carregar o histórico). */
  protected readonly covers = signal<Record<string, string>>(this.settings.loadCovers());

  protected readonly allSeries = computed(() => {
    const covers = this.covers();
    return groupBySeries(this.episodes()).map((s) => ({
      ...s,
      coverUrl: covers[s.seriesId] ?? s.coverUrl,
    }));
  });
  protected readonly visibleSeries = computed(() =>
    filterSeries(this.allSeries(), this.filters(), this.sort()),
  );
  protected readonly visibleEpisodes = computed(() =>
    filterEpisodes(this.episodes(), this.filters()),
  );
  protected readonly shownEpisodes = computed(() => this.visibleEpisodes().slice(0, this.limit()));
  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(
      f.query ||
      f.from ||
      f.to ||
      f.epMin !== null ||
      f.epMax !== null ||
      f.olderThanMonths !== null
    );
  });

  protected readonly pendingText = computed(() => {
    const p = this.pending();
    if (!p) return '';
    const n = p.episodes.length;
    let text =
      p.kind === 'series'
        ? `${n} episódio(s) de ${p.seriesCount} série(s) serão apagados do histórico.`
        : `${n} episódio(s) serão apagados do histórico.`;
    if (p.extra > 0) text += ` Isso inclui ${p.extra} que não estavam na lista carregada.`;
    return text;
  });

  constructor() {
    void this.update.check();
    // Ao voltar ao app (vindo de outro), confere de novo se há versão nova.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.update.checkIfDue();
    });
    if (this.loggedIn()) {
      // Mostra na hora a última lista guardada e atualiza por trás.
      const cached = this.settings.loadHistoryCache();
      if (cached.length > 0) {
        this.episodes.set(cached);
        this.loaded.set(true);
      }
      void this.refresh();
    }
  }

  // ---- sessão ----

  protected async login(): Promise<void> {
    this.loginBusy.set(true);
    this.loginError.set(null);
    try {
      await this.cr.login();
      await this.refresh();
    } catch (e) {
      this.loginError.set(e instanceof Error ? e.message : 'Falha no login.');
    } finally {
      this.loginBusy.set(false);
    }
  }

  protected async logout(): Promise<void> {
    await this.cr.logout();
    this.settings.clearHistoryCache();
    this.episodes.set([]);
    this.loaded.set(false);
    this.selected.set(new Set());
    this.selectedSeries.set(new Set());
    this.error.set(null);
    this.challenge.set(false);
  }

  /** Abre o site para concluir a verificação do Cloudflare e tenta de novo. */
  protected async resolveChallenge(): Promise<void> {
    await this.cr.openVerification();
    this.challenge.set(false);
    this.error.set(null);
    await this.refresh();
  }

  // ---- dados ----

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.episodes.set(await this.cr.listHistory(this.settings.maxEpisodes()));
      this.settings.saveHistoryCache(this.episodes());
      this.loaded.set(true);
      this.selected.set(new Set());
      this.selectedSeries.set(new Set());
      void this.loadCovers();
    } catch (e) {
      this.handleError(e);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadCovers(): Promise<void> {
    const known = this.covers();
    const missing = this.allSeries()
      .map((s) => s.seriesId)
      .filter((id) => !known[id]);
    if (missing.length === 0) return;
    try {
      const found = await this.cr.getSeriesCovers(missing);
      if (Object.keys(found).length === 0) return;
      const merged = { ...this.covers(), ...found };
      this.covers.set(merged);
      this.settings.saveCovers(merged);
    } catch (e) {
      this.handleError(e);
    }
  }

  /** Confere o histórico COMPLETO e monta a lista exata de episódios das séries a remover. */
  protected async startSeriesRemoval(seriesIds: string[]): Promise<void> {
    if (seriesIds.length === 0 || this.scanning()) return;
    this.scanning.set(true);
    this.error.set(null);
    try {
      const all = await this.cr.listHistory(FULL_SCAN_LIMIT);
      const episodes = episodesOfSeries(all, seriesIds);
      if (episodes.length === 0) {
        this.notice.set('Nada a remover: essas séries já não estão no histórico.');
        return;
      }
      const loaded = new Set(this.episodes().map((e) => e.episodeId));
      const extra = episodes.filter((e) => !loaded.has(e.episodeId)).length;
      this.backedUp.set(false);
      this.pending.set({ kind: 'series', episodes, seriesCount: seriesIds.length, extra });
    } catch (e) {
      this.handleError(e);
    } finally {
      this.scanning.set(false);
    }
  }

  protected removeSelectedSeries(): void {
    void this.startSeriesRemoval([...this.selectedSeries()]);
  }

  protected removeSelected(): void {
    const ids = this.selected();
    const episodes = this.episodes().filter((e) => ids.has(e.episodeId));
    if (episodes.length === 0) return;
    this.backedUp.set(false);
    this.pending.set({ kind: 'episodes', episodes, seriesCount: 0, extra: 0 });
  }

  protected closePending(): void {
    if (!this.removing()) this.pending.set(null);
  }

  /** Salva uma cópia (CSV) dos episódios que serão apagados, pelo menu Compartilhar. */
  protected async saveBackup(): Promise<void> {
    const p = this.pending();
    if (!p || this.backupBusy()) return;
    this.backupBusy.set(true);
    try {
      await this.backup.save(p.episodes);
      this.backedUp.set(true);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      // Fechar o menu Compartilhar sem escolher nada não é erro.
      if (!/cancel/i.test(msg))
        this.error.set('Não foi possível gerar a cópia. Você ainda pode remover sem ela.');
    } finally {
      this.backupBusy.set(false);
    }
  }

  protected cancelRemoval(): void {
    this.cancelRequested.set(true);
  }

  protected async confirmRemoval(): Promise<void> {
    const p = this.pending();
    if (!p || this.removing()) return;
    const ids = p.episodes.map((e) => e.episodeId);
    this.removing.set(true);
    this.cancelRequested.set(false);
    this.error.set(null);
    this.removeProgress.set({ done: 0, total: ids.length });
    try {
      const { deleted, failed, cancelled } = await this.cr.deleteEpisodes(ids, {
        onProgress: (done, total) => this.removeProgress.set({ done, total }),
        isCancelled: () => this.cancelRequested(),
      });
      const gone = new Set(deleted);
      this.episodes.update((list) => list.filter((e) => !gone.has(e.episodeId)));
      this.settings.saveHistoryCache(this.episodes());
      this.selected.update((s) => new Set([...s].filter((id) => !gone.has(id))));
      if (p.kind === 'series') this.selectMode.set(false);
      const alive = new Set(this.allSeries().map((s) => s.seriesId));
      this.selectedSeries.update((s) => new Set([...s].filter((id) => alive.has(id))));
      this.notice.set(
        cancelled
          ? `Cancelado: ${deleted.length} de ${ids.length} episódios foram removidos.`
          : failed.length
            ? `${deleted.length} de ${ids.length} removidos; ${failed.length} falharam. Veja o Diagnóstico.`
            : `${deleted.length} episódio(s) removido(s).`,
      );
    } catch (e) {
      this.handleError(e);
    } finally {
      this.removing.set(false);
      this.removeProgress.set(null);
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

  protected setMaxEpisodes(raw: string): void {
    const n = Number(raw);
    if (!EPISODE_LIMITS.includes(n) || n === this.settings.maxEpisodes()) return;
    this.settings.setMaxEpisodes(n);
    void this.refresh();
  }

  protected setStale(raw: string): void {
    const n = Number(raw);
    this.setFilter({ olderThanMonths: raw === '' || !Number.isFinite(n) ? null : n });
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

  protected toggleSeries(id: string): void {
    this.selectedSeries.update((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected clearSeriesSelection(): void {
    this.selectedSeries.set(new Set());
  }

  protected toggleSelectMode(): void {
    this.selectMode.update((v) => !v);
    this.selectedSeries.set(new Set());
  }

  protected selectAllVisible(): void {
    this.selected.set(new Set(this.visibleEpisodes().map((e) => e.episodeId)));
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
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
      this.challenge.set(e.code === 'CHALLENGE');
    } else {
      this.error.set('Erro inesperado. Veja o Diagnóstico.');
    }
  }
}
