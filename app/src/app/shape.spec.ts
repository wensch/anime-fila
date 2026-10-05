import { describe, expect, it } from 'vitest';
import { shapeOf } from './shape';

describe('shapeOf', () => {
  it('mostra campos e tipos, nunca valores', () => {
    const out = shapeOf({ total: 5, email: 'a@b.com', ok: true, data: [{ id: 'x', n: 1 }, {}] });
    expect(out).toBe('{total:num,email:txt,ok:bool,data:[2] de {id:txt,n:num}}');
    expect(out).not.toContain('a@b.com');
  });
  it('limita a profundidade e trata vazio/nulo', () => {
    expect(shapeOf({ a: { b: { c: { d: 1 } } } })).toBe('{a:{b:{c:{…}}}}');
    expect(shapeOf([])).toBe('[0]');
    expect(shapeOf(null)).toBe('null');
  });
});
