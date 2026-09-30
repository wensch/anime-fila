import { normalizeHistoryItem } from './group.js';

/**
 * Único ponto de contato com a API (não oficial) da Crunchyroll.
 * Os caminhos são configuráveis por env porque a API não é documentada e pode mudar.
 * `{account}` e `{id}` são substituídos nos templates.
 */
const DEFAULTS = {
  baseUrl: 'https://www.crunchyroll.com',
  mePath: '/accounts/v1/me',
  historyPath: '/content/v2/{account}/watch-history',
  deletePath: '/content/v2/{account}/watch-history/{id}',
  locale: 'pt-BR',
  pageSize: 100,
  maxPages: 200,
  deleteConcurrency: 5,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
};

export class UpstreamError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

export function createCrunchyrollClient({ fetchImpl = fetch, ...overrides } = {}) {
  const cfg = { ...DEFAULTS, ...overrides };

  async function call(token, path, { method = 'GET', query } = {}) {
    const url = new URL(cfg.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': cfg.userAgent,
      },
    });
    if (!res.ok) {
      throw new UpstreamError(res.status, `Crunchyroll respondeu ${res.status} em ${method} ${path}`);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  const fill = (tpl, vars) =>
    tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k]));

  async function getAccountId(token) {
    const me = await call(token, cfg.mePath);
    const id = me?.account_id;
    if (!id) throw new UpstreamError(502, 'Resposta de /me sem account_id');
    return id;
  }

  /** Percorre todas as páginas do histórico e devolve episódios normalizados. */
  async function getHistory(token, accountId) {
    const path = fill(cfg.historyPath, { account: accountId });
    const items = [];
    for (let page = 1; page <= cfg.maxPages; page++) {
      const body = await call(token, path, {
        query: { page, page_size: cfg.pageSize, locale: cfg.locale },
      });
      const data = body?.data ?? [];
      for (const raw of data) {
        const item = normalizeHistoryItem(raw);
        if (item) items.push(item);
      }
      const total = body?.total;
      if (data.length === 0 || data.length < cfg.pageSize) break;
      if (typeof total === 'number' && page * cfg.pageSize >= total) break;
    }
    return items;
  }

  /** Remove episódios em lotes paralelos; nunca lança por falha individual. */
  async function deleteEpisodes(token, accountId, episodeIds) {
    const deleted = [];
    const failed = [];
    for (let i = 0; i < episodeIds.length; i += cfg.deleteConcurrency) {
      const chunk = episodeIds.slice(i, i + cfg.deleteConcurrency);
      const results = await Promise.allSettled(
        chunk.map((id) =>
          call(token, fill(cfg.deletePath, { account: accountId, id }), { method: 'DELETE' }),
        ),
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') deleted.push(chunk[idx]);
        else failed.push({ id: chunk[idx], error: r.reason?.message ?? String(r.reason) });
      });
    }
    return { deleted, failed };
  }

  return { getAccountId, getHistory, deleteEpisodes };
}
