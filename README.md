# CrunchySync

App Android (APK) para gerenciar o histórico da Crunchyroll pelo celular, sem computador:

- **Séries:** histórico agrupado por série (como no iOS), com remoção da série inteira num toque.
- **Episódios:** lista completa, filtro por texto, intervalo de datas e número do episódio; seleção múltipla para remover episódios avulsos.
- **Login no próprio app:** e-mail e senha vão direto do aparelho para a Crunchyroll. A senha não é armazenada; só a sessão (tokens), que é renovada automaticamente.
- **Sem servidor:** as chamadas usam o HTTP nativo do Capacitor (sem CORS, com o IP do seu celular).

## Instalar o APK (pelo celular)

1. Abra a aba **Releases** do repositório no GitHub e entre em **CrunchySync (APK mais recente)**.
2. Baixe `CrunchySync.apk` e abra o arquivo (o Android pedirá para permitir instalar de fontes desconhecidas).
3. Abra o app e entre com sua conta.

O APK é gerado pelo workflow `.github/workflows/apk.yml` a cada push em `main` ou `claude/**` (também dá para rodar manualmente em Actions > Build APK).

### Atualizar sem desinstalar (opcional)

Sem configuração, o APK é assinado com uma chave de debug que muda a cada build; para atualizar, desinstale a versão anterior antes (você só precisa entrar de novo). Para assinar sempre com a mesma chave, crie um keystore e adicione estes *secrets* no repositório: `ANDROID_KEYSTORE_BASE64` (o arquivo em base64), `ANDROID_KEYSTORE_PASSWORD` e `ANDROID_KEY_ALIAS`.

## ⚠️ API não oficial e não verificada

A Crunchyroll não tem API pública. O login (`/auth/v1/token`, cliente OAuth do site), a listagem (`/content/v2/{account}/watch-history`) e a exclusão (`DELETE .../watch-history/{id}`) foram escritos de memória e **nunca foram testados contra o serviço real** (os testes usam uma Crunchyroll simulada). Podem falhar no primeiro uso.

Se falhar: toque em **Diagnóstico** no app. Ele lista cada chamada (método, caminho, status e erro; nunca senha ou token). Tire um print e use-o para corrigir. Os caminhos e o cliente OAuth também podem ser editados ali em *Configurações avançadas da API*, sem gerar novo APK. Todos os detalhes da API estão em `app/src/app/endpoints.ts`.

## Desenvolvimento

```bash
cd app
npm ci --legacy-peer-deps
npm test                 # lógica de agrupamento e filtros (vitest)
npx ng build && npx cap sync android
```

No navegador (`npm start`) o login é barrado por CORS; use o APK. Angular 21 (o 22 exige Node ≥ 22.22.3), Tailwind 4, Capacitor 8.
