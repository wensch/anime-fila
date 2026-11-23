import '@angular/compiler';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsService } from './settings.service';
import { ContinueItem } from './history';
import {
  isWidgetSize,
  isWidgetStyle,
  parseSeriesLink,
  toWidgetPayload,
  widgetCount,
} from './widget';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

const settings = () =>
  Injector.create({
    providers: [{ provide: SettingsService, useClass: SettingsService, deps: [] }],
  }).get(SettingsService);

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
});

describe('aparência do widget', () => {
  it('começa no carrossel médio', () => {
    const s = settings();
    expect(s.widgetStyle()).toBe('carousel');
    expect(s.widgetSize()).toBe('m');
  });

  it('guarda a escolha e a restaura na próxima abertura', () => {
    const s = settings();
    s.setWidgetStyle('hero');
    s.setWidgetSize('l');
    const again = settings();
    expect(again.widgetStyle()).toBe('hero');
    expect(again.widgetSize()).toBe('l');
  });

  it('valores inválidos guardados voltam ao padrão', () => {
    localStorage.setItem('crunchysync.v2', JSON.stringify({ widgetStyle: 'x', widgetSize: 9 }));
    const s = settings();
    expect(s.widgetStyle()).toBe('carousel');
    expect(s.widgetSize()).toBe('m');
    expect(isWidgetStyle('list')).toBe(true);
    expect(isWidgetSize('xl')).toBe(false);
  });

  it('a lista mostra mais itens quanto maior o tamanho; as demais rolam', () => {
    expect(widgetCount('list', 's')).toBeLessThan(widgetCount('list', 'm'));
    expect(widgetCount('list', 'm')).toBeLessThan(widgetCount('list', 'l'));
    expect(widgetCount('carousel', 's')).toBe(widgetCount('hero', 'l'));
  });
});

describe('widgets da tela inicial', () => {
  const item = (over: Partial<ContinueItem> = {}): ContinueItem => ({
    seriesId: 'S1',
    seriesTitle: 'Solo Leveling',
    episodeId: 'e1',
    episodeNumber: 9,
    episodeTitle: 'Ep',
    coverUrl: 'https://img/1.jpg',
    releasedAt: '2026-09-28T12:00:00Z',
    hasRelease: true,
    watchedAt: '2026-09-29T12:00:00Z',
    progress: 0.5,
    ...over,
  });

  it('monta o item com texto do episódio e data em ms', () => {
    const [p] = toWidgetPayload([item()]);
    expect(p).toEqual({
      seriesId: 'S1',
      title: 'Solo Leveling',
      episode: 'Ep. 9',
      releasedAt: Date.parse('2026-09-28T12:00:00Z'),
      hasRelease: true,
      progress: 0.5,
      coverUrl: 'https://img/1.jpg',
    });
  });

  it('sem número do episódio, sem data ou sem progresso não quebra', () => {
    const [p] = toWidgetPayload([item({ episodeNumber: null, releasedAt: null, progress: null })]);
    expect(p.episode).toBe('');
    expect(p.releasedAt).toBeNull();
    expect(p.progress).toBeNull();
  });

  it('envia no máximo 10 itens, na ordem recebida', () => {
    const many = Array.from({ length: 15 }, (_, i) => item({ seriesId: 'S' + i }));
    const out = toWidgetPayload(many);
    expect(out).toHaveLength(10);
    expect(out[0].seriesId).toBe('S0');
  });

  it('lê o endereço do toque no widget', () => {
    expect(parseSeriesLink('crunchysync://series/GRX123')).toBe('GRX123');
    expect(parseSeriesLink('crunchysync://series/a%20b')).toBe('a b');
    expect(parseSeriesLink('crunchysync://home')).toBeNull();
    expect(parseSeriesLink('https://example.com/series/x')).toBeNull();
    expect(parseSeriesLink(null)).toBeNull();
    expect(parseSeriesLink('crunchysync://series/%E0%A4%A')).toBeNull();
  });
});
