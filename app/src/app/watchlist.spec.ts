import { describe, expect, it } from 'vitest';
import { normalizeWatchlist } from './watchlist';
import { SyncStatus, describeSync } from './widget';

const item = (
  sid: string,
  over: Record<string, unknown> = {},
  meta: Record<string, unknown> = {},
) => ({
  new: true,
  fully_watched: false,
  never_watched: false,
  playhead: 0,
  panel: {
    id: `ep-${sid}`,
    title: `Título ${sid}`,
    episode_metadata: {
      series_id: sid,
      series_title: `Série ${sid}`,
      episode_number: 8,
      duration_ms: 1_400_000,
      premium_available_date: '2026-09-01T00:00:00Z',
      ...meta,
    },
    images: { thumbnail: [[{ width: 640, source: `https://img/${sid}.jpg` }]] },
  },
  ...over,
});

describe('lista "Continuar assistindo" da Crunchyroll', () => {
  it('formato inesperado devolve null (usa o histórico); lista vazia é válida', () => {
    expect(normalizeWatchlist(null)).toBeNull();
    expect(normalizeWatchlist({ error: 'x' })).toBeNull();
    expect(normalizeWatchlist({ data: 'oops' })).toBeNull();
    expect(normalizeWatchlist({ data: [] })).toEqual([]);
  });

  it('mostra o próximo episódio de cada série, com data de lançamento', () => {
    const [c] = normalizeWatchlist({ data: [item('A')] })!;
    expect(c).toMatchObject({
      seriesId: 'A',
      seriesTitle: 'Série A',
      episodeId: 'ep-A',
      episodeNumber: 8,
      coverUrl: 'https://img/A.jpg',
      releasedAt: '2026-09-01T00:00:00Z',
      hasRelease: true,
      progress: null,
      isNext: true,
    });
  });

  it('tira séries terminadas ou em dia, nunca começadas, filmes e séries sem episódio', () => {
    const out = normalizeWatchlist({
      data: [
        item('feita', { fully_watched: true }),
        item('nunca', { never_watched: true }),
        { panel: { id: 'serie', title: 'Só a série' } },
        { panel: { id: 'filme', episode_metadata: {} } },
        item('ok'),
      ],
    })!;
    expect(out.map((c) => c.seriesId)).toEqual(['ok']);
  });

  it('episódio começado mostra a barra de progresso e não é "próximo"', () => {
    const [c] = normalizeWatchlist({ data: [item('A', { playhead: 700 })] })!;
    expect(c.progress).toBeCloseTo(0.5);
    expect(c.isNext).toBe(false);
  });

  it('ordena pelo lançamento do episódio, o mais novo primeiro; sem repetir série', () => {
    const out = normalizeWatchlist({
      data: [
        item('velha', {}, { premium_available_date: '2026-01-01T00:00:00Z' }),
        item('nova', {}, { premium_available_date: '2026-10-09T00:00:00Z' }),
        item('nova', {}, { premium_available_date: '2026-10-01T00:00:00Z' }),
        item('semdata', {}, { premium_available_date: null }),
      ],
    })!;
    expect(out.map((c) => c.seriesId)).toEqual(['nova', 'velha', 'semdata']);
    expect(out[2].hasRelease).toBe(false);
  });
});

describe('describeSync', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  it('descreve fonte, tempos e erro', () => {
    const s: SyncStatus = {
      configured: true,
      lastOk: now - 5 * 60_000,
      lastAttempt: now - 60_000,
      lastError: 'sem conexão',
      source: 'watchlist',
    };
    expect(describeSync(s, now)).toBe(
      'fonte: lista da Crunchyroll; última atualização: há 5 min; última tentativa: há 1 min; erro: sem conexão',
    );
    expect(
      describeSync(
        { configured: false, lastOk: 0, lastAttempt: 0, lastError: '', source: '' },
        now,
      ),
    ).toBe(
      'fonte: ainda sem busca; última atualização: nunca; última tentativa: nunca; erro: nenhum',
    );
  });
});
