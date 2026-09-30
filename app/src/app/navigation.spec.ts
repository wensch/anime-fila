import { describe, expect, it } from 'vitest';
import { BackState, backAction } from './navigation';

const base: BackState = {
  updateOpen: false,
  updateBusy: false,
  scanning: false,
  removing: false,
  pendingOpen: false,
  menuOpen: false,
  diagOpen: false,
  filtersOpen: false,
  selectMode: false,
  episodesSelected: 0,
  tab: 'series',
};
const st = (o: Partial<BackState>): BackState => ({ ...base, ...o });

describe('botão Voltar', () => {
  it('na tela inicial de Séries, sai do app', () => {
    expect(backAction(base)).toBe('exit');
  });
  it('de Episódios volta para Séries (e só depois sai)', () => {
    expect(backAction(st({ tab: 'episodes' }))).toBe('toSeries');
  });
  it('fecha painéis e menus antes de navegar', () => {
    expect(backAction(st({ tab: 'episodes', filtersOpen: true }))).toBe('closeFilters');
    expect(backAction(st({ diagOpen: true, filtersOpen: true }))).toBe('closeDiag');
    expect(backAction(st({ menuOpen: true, diagOpen: true }))).toBe('closeMenu');
    expect(backAction(st({ pendingOpen: true, menuOpen: true }))).toBe('closePending');
  });
  it('sai da seleção antes de trocar de aba', () => {
    expect(backAction(st({ selectMode: true }))).toBe('exitSelectMode');
    expect(backAction(st({ tab: 'episodes', episodesSelected: 3 }))).toBe('clearEpisodeSelection');
  });
  it('durante remoção ou conferência, Voltar não faz nada', () => {
    expect(backAction(st({ removing: true, pendingOpen: true }))).toBe('consume');
    expect(backAction(st({ scanning: true }))).toBe('consume');
  });
  it('o aviso de atualização fecha primeiro, mas não durante o download', () => {
    expect(backAction(st({ updateOpen: true, pendingOpen: true }))).toBe('closeUpdate');
    expect(backAction(st({ updateOpen: true, updateBusy: true }))).toBe('consume');
  });
});
