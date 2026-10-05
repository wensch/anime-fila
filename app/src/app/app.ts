import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { CoverCacheService } from './cover-cache.service';
import { keyOf } from './cover-cache';
import { DialogFocus } from './dialog-focus';
import { plural, relativeTime } from './text';
import { ApiError, CrunchyrollService, SessionExpiredError } from './crunchyroll.service';
import { DiagnosticsService } from './diagnostics.service';
import {
  ARCHIVE_MAX,
  ApiConfig,
  EPISODE_LIMITS,
  FULL_SCAN_LIMIT,
  MAX_REMOVE_ROUNDS,
  limitLabel,
} from './endpoints';
import {
  EMPTY_FILTERS,
  Filters,
  SeriesSort,
  coverageGap,
  coverageStart,
  episodesOfSeries,
  filterEpisodes,
  filterSeries,
  groupBySeries,
  mergeArchive,
} from './history';
import { Episode } from './models';
import { BackState, backAction } from './navigation';
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
  /** Séries alvo (remoção de séries). */
  seriesIds: string[];
  /** O histórico pode ter mais episódios antigos além da janela que a API entrega. */
  capped: boolean;
  /** Episódios da série no catálogo que o histórico não lista (mais antigos que a janela). */
  catalogIds: string[];
}

const PAGE = 100;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

@Component({
  selector: 'app-root',
  imports: [DatePipe, DialogFocus],
  templateUrl: './app.html',
})
export class App {
  private readonly cr = inject(CrunchyrollService);
  private readonly coverCache = inject(CoverCacheService);
  protected readonly plural = plural;
  protected readonly relative = (iso: string | null) => relativeTime(iso);
  protected readonly settings = inject(SettingsService);
  protected readonly diag = inject(DiagnosticsService);
  protected readonly update = inject(UpdateService);

  protected readonly loggedIn = computed(() => this.settings.session() !== null);
  protected readonly episodes = signal<Episode[]>([]);
  protected readonly loaded = signal(false);
  /** O histórico pode ter mais episódios do que o app consegue ver (limite escolhido ou da API). */
  protected readonly mayHaveMore = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly loginBusy = signal(false);
  protected readonly loginError = signal<string | null>(null);

  protected readonly tab = signal<Tab>('series');
  /** Cada aba tem seus próprios filtros: o que se busca em Episódios não afeta Séries. */
  protected readonly seriesFilters = signal<Filters>({ ...EMPTY_FILTERS });
  protected readonly episodeFilters = signal<Filters>({ ...EMPTY_FILTERS });
  /** Filtros da aba ativa (o que a interface mostra e edita). */
  protected readonly filters = computed(() =>
    this.tab() === 'series' ? this.seriesFilters() : this.episodeFilters(),
  );
  /** Título da série de onde veio a aba Episódios (mostra a faixa "← Todas as séries"). */
  protected readonly drillTitle = signal<string | null>(null);
  protected readonly filtersOpen = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly skeletons = [1, 2, 3, 4, 5, 6];
  /** Rolou o bastante para mostrar o botão "voltar ao topo". */
  protected readonly scrolled = signal(false);
  /** Posição de rolagem de cada aba, para voltar exatamente onde estava. */
  private readonly scrollPos: Record<Tab, number> = { series: 0, episodes: 0 };
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressOrigin: { x: number; y: number } | null = null;
  private longPressed = false;
  private suppressClickUntil = 0;
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
  /** Texto mostrado na remoção entre uma rodada e outra. */
  protected readonly removePhase = signal('Removendo…');
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
    filterSeries(this.allSeries(), this.seriesFilters(), this.sort()),
  );
  protected readonly visibleEpisodes = computed(() =>
    filterEpisodes(this.episodes(), this.episodeFilters()),
  );
  protected readonly shownEpisodes = computed(() => this.visibleEpisodes().slice(0, this.limit()));
  /** Filtros ativos além da busca por texto (vira o número no botão "Filtros"). */
  protected readonly activeFilterCount = computed(() => {
    const f = this.filters();
    return [f.from, f.to, f.epMin, f.epMax, f.olderThanMonths].filter((v) => v !== '' && v !== null)
      .length;
  });
  /** Há uma barra de ação fixa embaixo (seleção): o botão "topo" sobe para não ficar por cima. */
  protected readonly actionBarVisible = computed(
    () =>
      (this.tab() === 'episodes' && this.selected().size > 0) ||
      (this.tab() === 'series' && this.selectedSeries().size > 0),
  );
  /** Desde quando o app enxerga o histórico (data do episódio mais antigo que conhece). */
  protected readonly coverageFrom = computed(() => coverageStart(this.episodes()));
  /** Filtro pede algo mais antigo do que o app enxerga: série antiga não apareceria. */
  protected readonly coverageGapAt = computed(() =>
    coverageGap(this.episodes(), this.mayHaveMore(), this.filters()),
  );
  protected readonly probing = signal(false);
  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(
      f.seriesId ||
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
    const what = plural(n, 'episódio', 'episódios');
    const verb = n === 1 ? 'será apagado' : 'serão apagados';
    let text =
      p.kind === 'series'
        ? `${what} de ${plural(p.seriesCount, 'série', 'séries')} ${verb} do histórico.`
        : `${what} ${verb} do histórico.`;
    if (p.extra > 0) text += ` Inclui ${p.extra} que não estavam na lista carregada.`;
    if (p.catalogIds.length > 0) {
      text += ` A Crunchyroll mostra só os episódios mais recentes do histórico; por isso o app também limpa pelo catálogo até ${plural(p.catalogIds.length, 'episódio mais antigo', 'episódios mais antigos')} dessas séries.`;
    } else if (p.capped) {
      text += ' Se houver mais antigos, o app repete a remoção até acabar.';
    }
    return text;
  });

  constructor() {
    // Some sozinho o aviso de sucesso depois de alguns segundos.
    effect((onCleanup) => {
      if (this.notice() === null) return;
      const t = setTimeout(() => this.notice.set(null), 8000);
      onCleanup(() => clearTimeout(t));
    });
    // Botão Voltar do Android (e evento equivalente para testes/navegador).
    if (Capacitor.isNativePlatform()) void CapApp.addListener('backButton', () => this.onBack());
    document.addEventListener('crunchysync:back', () => this.onBack());
    let ticking = false;
    window.addEventListener(
      'scroll',
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          this.scrolled.set(window.scrollY > window.innerHeight * 1.5);
          ticking = false;
        });
      },
      { passive: true },
    );
    void this.coverCache.init(); // lê as capas do disco (também num primeiro login)
    void this.update.check(); // Ao voltar ao app (vindo de outro), confere de novo se há versão nova.
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
    this.drillTitle.set(null);
    this.seriesFilters.set({ ...EMPTY_FILTERS });
    this.episodeFilters.set({ ...EMPTY_FILTERS });
    this.selectMode.set(false);
    this.tab.set('series');
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
      const scan = await this.cr.scanHistory(this.settings.maxEpisodes());
      // O que saiu da janela da API continua guardado no aparelho (histórico acumulado).
      this.episodes.set(mergeArchive(scan.episodes, this.episodes(), scan.capped, ARCHIVE_MAX));
      this.mayHaveMore.set(scan.capped);
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
    if (missing.length > 0) {
      try {
        const found = await this.cr.getSeriesCovers(missing);
        if (Object.keys(found).length > 0) {
          const merged = { ...this.covers(), ...found };
          this.covers.set(merged);
          this.settings.saveCovers(merged);
        }
      } catch (e) {
        this.handleError(e);
      }
    }
    // Guarda as capas no aparelho: na próxima vez abrem na hora e sem baixar de novo.
    const urls: Record<string, string> = {};
    for (const s of this.allSeries()) if (s.coverUrl) urls[s.seriesId] = s.coverUrl;
    void this.coverCache.sync(urls);
  }

  /** Endereço da capa: o arquivo salvo no aparelho, ou o remoto se ainda não foi baixado. */
  protected coverSrc(s: { seriesId: string; coverUrl: string | null }): string | null {
    if (!this.coverCache.ready()) return null;
    return this.coverCache.local()[keyOf(s.seriesId)] ?? s.coverUrl;
  }

  /** Confere o histórico COMPLETO e monta a lista exata de episódios das séries a remover. */
  protected async startSeriesRemoval(seriesIds: string[]): Promise<void> {
    if (seriesIds.length === 0 || this.scanning()) return;
    this.scanning.set(true);
    this.error.set(null);
    try {
      const { episodes: all, capped } = await this.cr.scanHistory(FULL_SCAN_LIMIT);
      const episodes = episodesOfSeries(all, seriesIds);
      // Se a API não entregou o histórico inteiro, os episódios mais antigos das séries podem
      // estar fora da lista: pega os IDs pelo catálogo para apagá-los também.
      let catalogIds: string[] = [];
      if (capped) {
        const known = new Set(episodes.map((e) => e.episodeId));
        const fromCatalog: string[] = [];
        for (const id of seriesIds) fromCatalog.push(...(await this.cr.getCatalogEpisodeIds(id)));
        catalogIds = [...new Set(fromCatalog)].filter((id) => !known.has(id));
      }
      if (episodes.length === 0 && catalogIds.length === 0) {
        this.notice.set('Nada a remover: essas séries já não estão no histórico.');
        return;
      }
      const loaded = new Set(this.episodes().map((e) => e.episodeId));
      const extra = episodes.filter((e) => !loaded.has(e.episodeId)).length;
      this.pending.set({
        kind: 'series',
        episodes,
        seriesCount: seriesIds.length,
        extra,
        seriesIds: [...seriesIds],
        capped,
        catalogIds,
      });
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
    this.pending.set({
      kind: 'episodes',
      episodes,
      seriesCount: 0,
      extra: 0,
      seriesIds: [],
      capped: false,
      catalogIds: [],
    });
  }

  protected closePending(): void {
    if (!this.removing()) this.pending.set(null);
  }

  protected cancelRemoval(): void {
    this.cancelRequested.set(true);
  }

  protected async confirmRemoval(): Promise<void> {
    const p = this.pending();
    if (!p || this.removing()) return;
    this.removing.set(true);
    this.cancelRequested.set(false);
    this.error.set(null);
    const deletedAll = new Set<string>(); // a Crunchyroll confirmou (204)
    const goneAll = new Set<string>(); // saíram do histórico (204) ou já não existiam (404)
    let failedCount = 0;
    let cancelled = false;
    let leftover = 0; // ainda listados no histórico depois de apagar
    let verified = p.kind !== 'series';
    let batch = [...p.episodes.map((e) => e.episodeId), ...p.catalogIds];
    const attempted = new Set(batch);
    let stillListed = new Set<string>();
    try {
      for (let round = 1; ; round++) {
        this.removePhase.set('Removendo…');
        this.removeProgress.set({ done: 0, total: batch.length });
        const out = await this.cr.deleteEpisodes(batch, {
          onProgress: (done, total) => this.removeProgress.set({ done, total }),
          isCancelled: () => this.cancelRequested(),
        });
        out.deleted.forEach((id) => {
          deletedAll.add(id);
          goneAll.add(id);
        });
        out.missing?.forEach((id) => goneAll.add(id));
        failedCount += out.failed.length;
        cancelled = !!out.cancelled;
        if (out.expired) throw new SessionExpiredError('Sessão expirada'); // o `finally` ainda reflete o que foi apagado
        if (p.kind !== 'series' || cancelled) break;
        // Confere o resultado de verdade: a Crunchyroll pode demorar a refletir e, depois de
        // apagar os recentes, os mais antigos das séries "sobem" para dentro da janela da API.
        this.removeProgress.set(null);
        this.removePhase.set('Conferindo se tudo saiu do histórico…');
        await sleep(1500);
        let again;
        try {
          again = await this.cr.scanHistory(FULL_SCAN_LIMIT);
        } catch (e) {
          if (e instanceof SessionExpiredError) throw e;
          break; // não deu para conferir; o aviso final diz isso
        }
        verified = true;
        const listed = episodesOfSeries(again.episodes, p.seriesIds);
        stillListed = new Set(listed.map((e) => e.episodeId));
        leftover = listed.length;
        const fresh = listed.filter((e) => !attempted.has(e.episodeId));
        if (fresh.length === 0 || round >= MAX_REMOVE_ROUNDS) break;
        batch = fresh.map((e) => e.episodeId);
        batch.forEach((id) => attempted.add(id));
      }
      const n = deletedAll.size;
      this.notice.set(
        cancelled
          ? `Cancelado: ${plural(n, 'episódio removido', 'episódios removidos')}.`
          : failedCount
            ? `${n} removidos; ${failedCount} falharam. Veja o Diagnóstico.`
            : leftover > 0
              ? `${n} removidos, mas ${leftover} ainda aparecem no histórico da Crunchyroll. Atualize daqui a pouco; se continuar, abra o Diagnóstico.`
              : n === 0
                ? 'Esses episódios já não estavam no histórico.'
                : p.kind === 'series' && verified
                  ? `${plural(n, 'episódio removido', 'episódios removidos')}. Conferido: nada restou dessas séries no histórico.`
                  : `${plural(n, 'episódio removido', 'episódios removidos')}.`,
      );
    } catch (e) {
      this.handleError(e);
    } finally {
      // Reflete na tela o que saiu do histórico, mesmo se algo falhou no meio.
      stillListed.forEach((id) => goneAll.delete(id)); // a Crunchyroll ainda lista: continua visível
      if (goneAll.size > 0) {
        this.episodes.update((list) => list.filter((e) => !goneAll.has(e.episodeId)));
        this.settings.saveHistoryCache(this.episodes());
        this.selected.update((s) => new Set([...s].filter((id) => !goneAll.has(id))));
        const alive = new Set(this.allSeries().map((s) => s.seriesId));
        this.selectedSeries.update((s) => new Set([...s].filter((id) => alive.has(id))));
      }
      if (p.kind === 'series') this.selectMode.set(false);
      this.removing.set(false);
      this.removeProgress.set(null);
      this.pending.set(null);
    }
  }

  /** Sonda de leitura: registra no Diagnóstico a forma das respostas de endpoints candidatos. */
  protected async probeApi(): Promise<void> {
    if (this.probing()) return;
    this.probing.set(true);
    try {
      const first = this.episodes()[0];
      await this.cr.probeApi({
        episodeIds: this.episodes()
          .slice(0, 3)
          .map((e) => e.episodeId),
        seriesId: first?.seriesId ?? null,
      });
    } catch (e) {
      this.handleError(e);
    } finally {
      this.probing.set(false);
    }
  }

  // ---- filtros e seleção ----

  protected setFilter(patch: Partial<Filters>): void {
    const target = this.tab() === 'series' ? this.seriesFilters : this.episodeFilters;
    target.update((f) => ({ ...f, ...patch }));
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
    if (this.tab() === 'series') {
      this.seriesFilters.set({ ...EMPTY_FILTERS });
    } else {
      this.episodeFilters.set({ ...EMPTY_FILTERS });
      this.drillTitle.set(null);
    }
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

  /** Abre Episódios já filtrado pela série, com a faixa "← Todas as séries" para voltar. */
  protected showSeriesEpisodes(seriesId: string, title: string): void {
    this.scrollPos[this.tab()] = window.scrollY;
    this.episodeFilters.set({ ...EMPTY_FILTERS, seriesId });
    this.drillTitle.set(title);
    this.selected.set(new Set());
    this.filtersOpen.set(false);
    this.limit.set(PAGE);
    this.scrollPos.episodes = 0;
    this.tab.set('episodes');
    this.restoreScroll(0);
  }

  protected setTab(t: Tab): void {
    if (t === this.tab()) return;
    if (t === 'series' && this.drillTitle() !== null) return this.backToSeries();
    this.scrollPos[this.tab()] = window.scrollY;
    this.filtersOpen.set(false);
    this.tab.set(t);
    this.restoreScroll(this.scrollPos[t]);
  }

  /** Volta de Episódios para Séries, desfazendo o filtro de "veio de uma série". */
  protected backToSeries(): void {
    if (this.drillTitle() !== null) this.episodeFilters.set({ ...EMPTY_FILTERS });
    this.scrollPos[this.tab()] = window.scrollY;
    this.drillTitle.set(null);
    this.filtersOpen.set(false);
    this.tab.set('series');
    this.restoreScroll(this.scrollPos.series);
  }

  /** Rola depois que a aba nova for desenhada (senão a página ainda está curta demais). */
  private restoreScroll(y: number): void {
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: y })));
  }

  protected scrollToTop(): void {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  // ---- pressionar e segurar uma capa para começar a selecionar ----

  protected pressStart(ev: PointerEvent, seriesId: string): void {
    if (this.selectMode()) return;
    this.pressOrigin = { x: ev.clientX, y: ev.clientY };
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      this.longPressed = true;
      this.selectMode.set(true);
      this.selectedSeries.set(new Set([seriesId]));
      try {
        navigator.vibrate?.(30);
      } catch {
        /* sem vibração */
      }
    }, 500);
  }

  protected pressMove(ev: PointerEvent): void {
    if (!this.pressTimer || !this.pressOrigin) return;
    if (Math.hypot(ev.clientX - this.pressOrigin.x, ev.clientY - this.pressOrigin.y) > 10) {
      this.pressCancel();
    }
  }

  protected pressCancel(): void {
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.pressTimer = null;
    if (this.longPressed) {
      // o clique que encerra o "segurar" não pode desmarcar a série recém-marcada
      this.longPressed = false;
      this.suppressClickUntil = Date.now() + 250;
    }
  }

  protected coverClick(seriesId: string): void {
    if (Date.now() < this.suppressClickUntil) return;
    if (this.selectMode()) this.toggleSeries(seriesId);
  }

  // ---- menu, diagnóstico e botão Voltar ----

  protected openDiagnostics(): void {
    this.menuOpen.set(false);
    this.showDiag.set(true);
    window.scrollTo({ top: 0 });
  }

  protected async doLogout(): Promise<void> {
    this.menuOpen.set(false);
    await this.logout();
  }

  /** Decide o que o Voltar faz (ver navigation.ts) e aplica. */
  private onBack(): void {
    const state: BackState = {
      updateOpen: this.update.available() !== null,
      updateBusy: this.update.progress() !== null,
      scanning: this.scanning(),
      removing: this.removing(),
      pendingOpen: this.pending() !== null,
      menuOpen: this.menuOpen(),
      diagOpen: this.showDiag(),
      filtersOpen: this.filtersOpen(),
      selectMode: this.selectMode(),
      episodesSelected: this.selected().size,
      tab: this.tab(),
    };
    switch (backAction(state)) {
      case 'closeUpdate':
        return this.update.dismiss();
      case 'closePending':
        return this.closePending();
      case 'closeMenu':
        return this.menuOpen.set(false);
      case 'closeDiag':
        return this.showDiag.set(false);
      case 'closeFilters':
        return this.filtersOpen.set(false);
      case 'exitSelectMode':
        return this.toggleSelectMode();
      case 'clearEpisodeSelection':
        return this.clearSelection();
      case 'toSeries':
        return this.backToSeries();
      case 'exit':
        if (Capacitor.isNativePlatform()) void CapApp.exitApp();
        return;
      default:
        return; // 'consume': há uma operação em andamento
    }
  }

  // ---- configuração e diagnóstico ----

  protected saveConfig(values: Partial<Record<keyof ApiConfig, string>>): void {
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
