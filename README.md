# CrunchySync

App Android (APK) para gerenciar o histórico da Crunchyroll pelo celular, sem computador:

- **Séries:** histórico agrupado por série (como no iOS), com remoção da série inteira num toque.
- **Remoção em massa:** marque várias séries e remova de uma vez. Como a API do histórico só entrega os episódios mais recentes, o app também pega os IDs de todos os episódios da série no catálogo (temporadas, episódios e versões dubladas) e apaga os mais antigos que o histórico não lista; depois **confere de novo** o histórico e avisa se algo ainda aparece. Mostra o progresso e permite cancelar.
- **Filtros:** texto, datas (da última vez assistida, nas séries), ordenação e "sem assistir há mais de N meses". O painel mostra desde quando o app enxerga o histórico e avisa quando o filtro pede algo mais antigo que isso.
- **Alcance do histórico:** "Carregar até" vai de 100 a 5000. O app tenta páginas grandes e, se a API recusar, volta às de 100; o que sai da janela da Crunchyroll continua guardado no aparelho (histórico acumulado), então o alcance cresce com o uso.
- **Diagnóstico → Investigar a API:** sonda só de leitura que registra a *forma* (campos e tipos, nunca valores) das respostas de endpoints candidatos (Fila/watchlist, progresso, metadados e catálogo); serve para evoluir o app.
- **Navegação:** o botão Voltar do Android fecha painéis e menus, sai da seleção e volta de Episódios para Séries antes de sair do app; cada aba tem seus filtros; abas e busca ficam fixas ao rolar; alvos de toque de 48 px.
- **Capas no aparelho:** as capas das séries são salvas no armazenamento do celular e abrem na hora, sem baixar de novo; as abas ficam montadas, então trocar de aba não recarrega nada.
- **Seleção rápida:** segure a capa de uma série para começar a selecionar (já marcando aquela); as datas dos cards são relativas ("há 2 dias", o dia exato fica no toque longo do texto no navegador).
- **Listas longas:** botão "voltar ao topo" e a rolagem de cada aba é lembrada ao ir e voltar de Episódios.
- **Abertura rápida:** mostra a última lista guardada na hora e atualiza por trás.
- **Episódios:** lista completa, filtro por texto, intervalo de datas e número do episódio; seleção múltipla para remover episódios avulsos.
- **Login na página oficial:** o app abre o site da Crunchyroll num WebView; você digita e-mail e senha lá (o app nunca os vê) e a sessão é renovada pelo cookie do site.
- **Sem servidor:** todas as chamadas saem de dentro desse WebView (plugin Android `PageFetch`, em `app/android/.../PageFetchPlugin.java`), com o IP do seu celular. Isso é necessário porque o Cloudflare da Crunchyroll barra clientes HTTP comuns (erro 403 "Just a moment...").

## Instalar o APK (pelo celular)

1. Abra a aba **Releases** do repositório no GitHub e entre em **CrunchySync (APK mais recente)**.
2. Baixe `CrunchySync.apk` e abra o arquivo (o Android pedirá para permitir instalar de fontes desconhecidas).
3. Abra o app, toque em **Entrar** e faça login na página da Crunchyroll (conclua a verificação, se aparecer).

O APK é gerado pelo workflow `.github/workflows/apk.yml` a cada push em `main` ou `claude/**` (também dá para rodar manualmente em Actions > Build APK).

### Atualizações

O app avisa quando há build novo na release e atualiza por dentro (baixa o APK, mostra o progresso e abre a confirmação do Android; na primeira vez o Android pede para permitir instalar apps desta fonte). Precisa da assinatura fixa abaixo.

### Assinatura fixa (obrigatória para atualizar por cima)

Sem configuração, o APK é assinado com uma chave de debug que muda a cada build; para atualizar, desinstale a versão anterior antes (você só precisa entrar de novo). Para assinar sempre com a mesma chave, crie um keystore e adicione estes *secrets* no repositório: `ANDROID_KEYSTORE_BASE64` (o arquivo em base64), `ANDROID_KEYSTORE_PASSWORD` e `ANDROID_KEY_ALIAS`.

## ⚠️ API não oficial e não verificada

A Crunchyroll não tem API pública. O token (`/auth/v1/token` com `grant_type=etp_rt_cookie`, cliente OAuth do site), a listagem (`/content/v2/{account}/watch-history`) e a exclusão (`DELETE .../watch-history/{id}`) foram escritos de memória e **nunca foram testados contra o serviço real** (os testes usam uma Crunchyroll simulada). Podem falhar no primeiro uso.

Se falhar: toque em **Diagnóstico** no app. Ele lista cada chamada (método, caminho, status e erro; nunca senha ou token). Tire um print e use-o para corrigir. Os caminhos e o cliente OAuth também podem ser editados ali em *Configurações avançadas da API*, sem gerar novo APK. Todos os detalhes da API estão em `app/src/app/endpoints.ts`.

## Desenvolvimento

```bash
cd app
npm ci --legacy-peer-deps
npm test                 # agrupamento, filtros, datas e cliente da API (vitest)
npm run format:check     # Prettier (também roda no CI)
npx ng build && npx cap sync android
```

No navegador (`npm start`) o login não funciona (só existe no APK); a lógica de listas e filtros é coberta por `npm test`. Angular 21 (o 22 exige Node ≥ 22.22.3), Tailwind 4, Capacitor 8.
