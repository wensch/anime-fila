import express from 'express';
import cors from 'cors';
import { groupBySeries } from './group.js';
import { UpstreamError } from './crunchyroll.js';

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
  return m?.[1]?.trim() || null;
}

export function createApp({ client }) {
  const app = express();
  app.use(cors());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Todas as rotas abaixo exigem o token da sessão do usuário (repassado, nunca armazenado).
  app.use((req, res, next) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'Cabeçalho Authorization: Bearer <token> ausente' });
    req.token = token;
    next();
  });

  app.get(
    '/series',
    asyncH(async (req, res) => {
      const accountId = await client.getAccountId(req.token);
      const history = await client.getHistory(req.token, accountId);
      res.json(groupBySeries(history));
    }),
  );

  // O servidor reconsulta o histórico e decide os IDs a apagar (não confia no cliente).
  app.delete(
    '/series/:id',
    asyncH(async (req, res) => {
      const accountId = await client.getAccountId(req.token);
      const history = await client.getHistory(req.token, accountId);
      const ids = history.filter((e) => e.seriesId === req.params.id).map((e) => e.episodeId);
      if (ids.length === 0) return res.status(404).json({ error: 'Série não encontrada no histórico' });
      const { deleted, failed } = await client.deleteEpisodes(req.token, accountId, ids);
      res.status(failed.length ? 207 : 200).json({
        seriesId: req.params.id,
        requested: ids.length,
        deleted: deleted.length,
        failed,
      });
    }),
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof UpstreamError) {
      if (err.status === 401 || err.status === 403) {
        return res.status(401).json({ error: 'Token recusado pela Crunchyroll (expirado ou bloqueado)' });
      }
      return res.status(502).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  });

  return app;
}
