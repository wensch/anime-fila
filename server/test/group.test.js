import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBySeries, normalizeHistoryItem, pickLargestImage } from '../src/group.js';

const raw = (id, seriesId, played, extra = {}) => ({
  date_played: played,
  panel: {
    id,
    title: `Ep ${id}`,
    episode_metadata: { series_id: seriesId, series_title: `Série ${seriesId}`, episode_number: 1 },
    images: { thumbnail: [[{ width: 320, source: `small-${id}` }, { width: 1280, source: `big-${id}` }]] },
    ...extra,
  },
});

test('pickLargestImage escolhe a maior largura', () => {
  assert.equal(pickLargestImage(raw('a', 's', null).panel.images), 'big-a');
  assert.equal(pickLargestImage(undefined), null);
});

test('normalizeHistoryItem ignora itens sem série', () => {
  assert.equal(normalizeHistoryItem({ panel: { id: 'movie' } }), null);
  assert.equal(normalizeHistoryItem(raw('e1', 'S1', '2026-01-01T00:00:00Z')).seriesId, 'S1');
});

test('groupBySeries consolida 12 episódios em 1 série com 12 ids', () => {
  const items = Array.from({ length: 12 }, (_, i) =>
    normalizeHistoryItem(raw(`e${i}`, 'S1', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`)),
  );
  const out = groupBySeries(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].episodeCount, 12);
  assert.equal(out[0].episodeIds.length, 12);
  assert.equal(out[0].coverUrl, 'big-e11'); // capa do episódio mais recente
});

test('groupBySeries ordena por último assistido desc', () => {
  const items = [
    raw('a1', 'A', '2026-01-01T00:00:00Z'),
    raw('b1', 'B', '2026-03-01T00:00:00Z'),
    raw('a2', 'A', '2026-02-01T00:00:00Z'),
  ].map(normalizeHistoryItem);
  assert.deepEqual(groupBySeries(items).map((s) => s.seriesId), ['B', 'A']);
});
