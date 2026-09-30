/** Estado da interface relevante para decidir o que o botão Voltar do Android faz. */
export interface BackState {
  updateOpen: boolean;
  updateBusy: boolean;
  scanning: boolean;
  removing: boolean;
  pendingOpen: boolean;
  menuOpen: boolean;
  diagOpen: boolean;
  filtersOpen: boolean;
  selectMode: boolean;
  episodesSelected: number;
  tab: 'series' | 'episodes';
}

export type BackAction =
  | 'consume'
  | 'closeUpdate'
  | 'closePending'
  | 'closeMenu'
  | 'closeDiag'
  | 'closeFilters'
  | 'exitSelectMode'
  | 'clearEpisodeSelection'
  | 'toSeries'
  | 'exit';

/**
 * Do mais "por cima" para o mais "por baixo": avisos, menus e painéis fecham primeiro,
 * depois a seleção, depois Episódios volta para Séries, e só então o app sai.
 * Operações em andamento (remover, conferir histórico, baixar) consomem o Voltar sem fazer nada.
 */
export function backAction(s: BackState): BackAction {
  if (s.updateOpen) return s.updateBusy ? 'consume' : 'closeUpdate';
  if (s.scanning || s.removing) return 'consume';
  if (s.pendingOpen) return 'closePending';
  if (s.menuOpen) return 'closeMenu';
  if (s.diagOpen) return 'closeDiag';
  if (s.filtersOpen) return 'closeFilters';
  if (s.tab === 'series' && s.selectMode) return 'exitSelectMode';
  if (s.tab === 'episodes' && s.episodesSelected > 0) return 'clearEpisodeSelection';
  if (s.tab === 'episodes') return 'toSeries';
  return 'exit';
}
