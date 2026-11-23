import '@angular/compiler';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsService } from './settings.service';
import { isWidgetSize, isWidgetStyle, widgetCount } from './widget';

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
