# CrunchySync

Cliente customizado que devolve ao Android o que o iOS da Crunchyroll já tem: **histórico agrupado por série** e **remoção da série inteira com um toque**. Especificação: "Problema de Paridade: Gestão de Histórico".

```
Angular + Tailwind (app/)  ──►  BFF Node/Express (server/)  ──►  API da Crunchyroll
   empacotado em APK via Capacitor      agrupa por series_id, apaga em lote
```

## BFF (`server/`)

```bash
cd server && npm install
npm start          # porta 3000 (PORT)
npm test           # testes com upstream simulado
```

| Rota | Descrição |
| --- | --- |
| `GET /series` | Histórico paginado e consolidado por `series_id` (`seriesId`, `title`, `coverUrl`, `episodeCount`, `lastWatchedAt`, `episodeIds`), mais recentes primeiro |
| `DELETE /series/:id` | Reconsulta o histórico, localiza os episódios da série e os apaga em lotes paralelos (`Promise.allSettled`, 5 por vez). `200` se tudo foi removido, `207` com a lista de falhas se parcial, `404` se a série não está no histórico |
| `GET /health` | Liveness |

Todas exigem `Authorization: Bearer <token>`, repassado à Crunchyroll e nunca armazenado. Token recusado pela Crunchyroll vira `401`.

### ⚠️ Endpoints da Crunchyroll não verificados

A API da Crunchyroll não é pública. Os caminhos usados (`src/crunchyroll.js`) foram escritos de memória e **não foram testados contra o serviço real** (a suíte usa um upstream simulado). Se algo falhar, ajuste por variável de ambiente, sem mexer no código:

| Variável | Padrão |
| --- | --- |
| `CR_BASE_URL` | `https://www.crunchyroll.com` |
| `CR_ME_PATH` | `/accounts/v1/me` (deve devolver `account_id`) |
| `CR_HISTORY_PATH` | `/content/v2/{account}/watch-history` (paginado com `page`/`page_size`) |
| `CR_DELETE_PATH` | `/content/v2/{account}/watch-history/{id}` |
| `CR_LOCALE`, `CR_USER_AGENT` | `pt-BR`, UA de Chrome Android |

Cloudflare pode bloquear requisições vindas de IPs de datacenter; rode o BFF em casa (PC/Raspberry) se isso ocorrer.

## App (`app/`)

```bash
cd app && npm install
npm start                # http://localhost:4200
npm run cap:sync         # build + copia para o projeto Android
npm run cap:open         # abre no Android Studio -> Build > Build APK
```

Na primeira abertura, informe a URL do BFF e o token (DevTools > Network > cabeçalho `Authorization` de uma requisição em crunchyroll.com). Ambos ficam no `localStorage` do aparelho.

`capacitor.config.ts` usa `androidScheme: 'http'` + `cleartext: true` para que o WebView consiga falar com um BFF em HTTP na rede local. Se hospedar o BFF com HTTPS, pode voltar ao padrão.

> Nota: o Angular 21 foi escolhido porque o Angular 22 exige Node ≥ 22.22.3.
