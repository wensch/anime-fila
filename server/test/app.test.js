import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createCrunchyrollClient } from '../src/crunchyroll.js';

const ep = (id, seriesId, played) => ({
  date_played: played,
  panel: {
    id,
    title: id,
    episode_metadata: { series_id: seriesId, series_title: `T-${seriesId}` },
    images: { thumbnail: [[{ width: 640, source: `img-${id}` }]] },
  },
});

/** Fake de fetch que simula a Crunchyroll. */
function fakeUpstream({ history, failDelete = [] }) {
  const calls = [];
  const remaining = [...history];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, auth: init.headers.Authorization });
    if (init.headers.Authorization !== 'Bearer good') return { ok: false, status: 401 };
    if (u.pathname === '/accounts/v1/me') return json({ account_id: 'acc1' });
    if (u.pathname === '/content/v2/acc1/watch-history' && init.method === 'GET') {
      const page = Number(u.searchParams.get('page'));
      const size = Number(u.searchParams.get('page_size'));
      return json({ total: remaining.length, data: remaining.slice((page - 1) * size, page * size) });
    }
    const m = /^\/content\/v2\/acc1\/watch-history\/(.+)$/.exec(u.pathname);
    if (m && init.method === 'DELETE') {
      if (failDelete.includes(m[1])) return { ok: false, status: 500 };
      const i = remaining.findIndex((h) => h.panel.id === m[1]);
      if (i >= 0) remaining.splice(i, 1);
      return { ok: true, status: 204 };
    }
    return { ok: false, status: 404 };
  };
  return { fetchImpl, calls, remaining };
}
const json = (body) => ({ ok: true, status: 200, json: async () => body });

async function start(upstream, overrides = {}) {
  const client = createCrunchyrollClient({ fetchImpl: upstream.fetchImpl, pageSize: 5, ...overrides });
  const server = createApp({ client }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => server.close() };
}
const auth = { Authorization: 'Bearer good' };

test('rejeita requisições sem token', async () => {
  const s = await start(fakeUpstream({ history: [] }));
  const res = await fetch(`${s.base}/series`);
  assert.equal(res.status, 401);
  s.close();
});

test('token inválido vira 401', async () => {
  const s = await start(fakeUpstream({ history: [] }));
  const res = await fetch(`${s.base}/series`, { headers: { Authorization: 'Bearer bad' } });
  assert.equal(res.status, 401);
  s.close();
});

test('GET /series pagina e agrupa', async () => {
  const history = [
    ...Array.from({ length: 12 }, (_, i) => ep(`a${i}`, 'A', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`)),
    ep('b0', 'B', '2026-02-01T00:00:00Z'),
  ];
  const up = fakeUpstream({ history });
  const s = await start(up);
  const res = await fetch(`${s.base}/series`, { headers: auth });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.length, 2);
  assert.equal(body.find((x) => x.seriesId === 'A').episodeIds.length, 12);
  assert.equal(up.calls.filter((c) => c.path.endsWith('/watch-history')).length, 3); // 13 itens / 5 por página
  s.close();
});

test('DELETE /series/:id remove todos os episódios da série', async () => {
  const history = [...Array.from({ length: 12 }, (_, i) => ep(`a${i}`, 'A', '2026-01-01T00:00:00Z')), ep('b0', 'B', '2026-02-01T00:00:00Z')];
  const up = fakeUpstream({ history });
  const s = await start(up);
  const res = await fetch(`${s.base}/series/A`, { method: 'DELETE', headers: auth });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { seriesId: 'A', requested: 12, deleted: 12, failed: [] });
  assert.deepEqual(up.remaining.map((h) => h.panel.id), ['b0']);
  s.close();
});

test('DELETE parcial responde 207 com as falhas', async () => {
  const up = fakeUpstream({ history: [ep('a0', 'A', null), ep('a1', 'A', null)], failDelete: ['a1'] });
  const s = await start(up);
  const res = await fetch(`${s.base}/series/A`, { method: 'DELETE', headers: auth });
  const body = await res.json();
  assert.equal(res.status, 207);
  assert.equal(body.deleted, 1);
  assert.equal(body.failed[0].id, 'a1');
  s.close();
});

test('DELETE de série inexistente dá 404', async () => {
  const s = await start(fakeUpstream({ history: [ep('a0', 'A', null)] }));
  const res = await fetch(`${s.base}/series/ZZZ`, { method: 'DELETE', headers: auth });
  assert.equal(res.status, 404);
  s.close();
});
