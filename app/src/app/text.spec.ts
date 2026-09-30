import { describe, expect, it } from 'vitest';
import { relativeTime } from './text';

describe('datas relativas', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const H = 3_600_000;
  const D = 24 * H;
  it('escolhe a unidade certa, no singular e no plural', () => {
    expect(relativeTime(ago(20_000), now)).toBe('agora');
    expect(relativeTime(ago(5 * 60_000), now)).toBe('há 5 min');
    expect(relativeTime(ago(3 * H), now)).toBe('há 3 h');
    expect(relativeTime(ago(30 * H), now)).toBe('ontem');
    expect(relativeTime(ago(4 * D), now)).toBe('há 4 dias');
    expect(relativeTime(ago(8 * D), now)).toBe('há 1 semana');
    expect(relativeTime(ago(15 * D), now)).toBe('há 2 semanas');
    expect(relativeTime(ago(40 * D), now)).toBe('há 1 mês');
    expect(relativeTime(ago(250 * D), now)).toBe('há 8 meses');
    expect(relativeTime(ago(364 * D), now)).toBe('há 11 meses');
    expect(relativeTime(ago(400 * D), now)).toBe('há 1 ano');
    expect(relativeTime(ago(800 * D), now)).toBe('há 2 anos');
  });
  it('sem data ou no futuro não quebra', () => {
    expect(relativeTime(null, now)).toBe('');
    expect(relativeTime(ago(-5 * D), now)).toBe('agora');
  });
});
