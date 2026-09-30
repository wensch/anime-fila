import { describe, expect, it } from 'vitest';
import { coverFileName, hashUrl, keyOf, parseCoverFileName } from './cover-cache';
import { plural } from './text';

describe('cache de capas', () => {
  it('hash é estável e muda com a URL', () => {
    expect(hashUrl('https://img/a.jpg')).toBe(hashUrl('https://img/a.jpg'));
    expect(hashUrl('https://img/a.jpg')).not.toBe(hashUrl('https://img/b.jpg'));
  });
  it('nome do arquivo sanitiza o id e faz ida e volta', () => {
    const name = coverFileName('GY8D/48P0Y', 'https://img/a.jpg');
    expect(name).toMatch(/^GY8D_48P0Y\.[0-9a-z]+\.jpg$/);
    expect(parseCoverFileName(name)).toEqual({
      key: keyOf('GY8D/48P0Y'),
      hash: hashUrl('https://img/a.jpg'),
    });
  });
  it('ignora arquivos que não são capas', () => {
    expect(parseCoverFileName('leia-me.txt')).toBeNull();
    expect(parseCoverFileName('semhash.jpg')).toBeNull();
  });
});

describe('plural', () => {
  it('singular só para 1', () => {
    expect(plural(1, 'série', 'séries')).toBe('1 série');
    expect(plural(0, 'série', 'séries')).toBe('0 séries');
    expect(plural(47, 'série', 'séries')).toBe('47 séries');
  });
});
