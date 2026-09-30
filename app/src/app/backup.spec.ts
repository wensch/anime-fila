import { describe, expect, it } from 'vitest';
import { backupFileName, buildCsv } from './backup';
import { Episode } from './models';

const ep = (over: Partial<Episode>): Episode => ({
  episodeId: 'E1',
  seriesId: 'S1',
  seriesTitle: 'Série',
  episodeTitle: 'Título',
  episodeNumber: 3,
  coverUrl: null,
  watchedAt: '2026-09-30T12:00:00Z',
  ...over,
});

describe('backup CSV', () => {
  it('tem BOM, cabeçalho e uma linha por episódio', () => {
    const csv = buildCsv([ep({}), ep({ episodeId: 'E2', episodeNumber: null })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Série,Episódio');
    expect(lines[1]).toBe('Série,3,Título,2026-09-30T12:00:00Z,E1,S1');
    expect(lines[2]).toBe('Série,,Título,2026-09-30T12:00:00Z,E2,S1'); // número nulo = campo vazio
  });
  it('escapa aspas, vírgulas e quebras de linha', () => {
    const csv = buildCsv([ep({ seriesTitle: 'A, "B"', episodeTitle: 'linha1\nlinha2' })]);
    expect(csv).toContain('"A, ""B"""');
    expect(csv).toContain('"linha1\nlinha2"');
  });
  it('nome do arquivo com data e hora', () => {
    expect(backupFileName(new Date(2026, 8, 5, 7, 9))).toBe('crunchysync-copia-20260905-0709.csv');
  });
});
