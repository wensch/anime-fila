# CrunchySync

App Android (APK) para gerenciar o histórico da Crunchyroll pelo celular, sem computador:

- **Séries:** histórico agrupado por série (como no iOS), com remoção da série inteira num toque.
- **Remoção em massa:** marque várias séries e remova de uma vez. Como a API do histórico só entrega os episódios mais recentes, o app também pega os IDs de todos os episódios da série no catálogo (temporadas, episódios e versões dubladas) e apaga os mais antigos que o histórico não lista; depois **confere de novo** o histórico e avisa se algo ainda aparece. Mostra o progresso e permite cancelar.
- **Filtros:** texto, datas (da última vez assistida, nas séries), ordenação e "sem assistir há mais de N meses". O painel mostra desde quando o app enxerga o histórico e avisa quando o filtro pede algo mais antigo que isso.
- **Alcance do histórico:** "Carregar até" vai de 100 a 5000. O app tenta páginas grandes e, se a API recusar, volta às de 100; o que sai da janela da Crunchyroll continua guardado no aparelho (histórico acumulado), então o alcance cresce com o uso.
- **Diagnóstico → Investigar a API:** sonda só de leitura que registra a *forma* (campos e tipos, nunca valores) das respostas de endpoints candidatos (Fila/watchlist, progresso, metadados e catálogo); serve para evoluir o app.
- **Navegação:** o botão Voltar do Android fecha painéis e menus, sai da seleção e volta de Episódios para Séries antes de sair do app; cada aba tem seus filtros; abas e busca ficam fixas ao rolar; alvos de toque de 48 px.
- **Capas no aparelho:** as capas das séries são salvas no armazenamento do celular e abrem na hora, sem baixar de novo; as abas ficam montadas, então trocar de aba não recarrega nada.
- **Continuar assistindo:** carrossel no topo de Séries, como a fila da Crunchyroll: um cartão por série, ordenado pelo **lançamento do episódio** (o mais novo primeiro). Se o último episódio que você viu já terminou, o cartão mostra o **próximo episódio já lançado** (buscado no catálogo da série, com temporadas e dublagens) e a data em que ele saiu; se você parou no meio, continua o mesmo episódio com a barra de progresso; **séries terminadas, ou em dia com os lançamentos, saem da fila** e voltam quando sair episódio novo. O resultado de cada série fica guardado no aparelho (6 h sem próximo, 24 h com próximo), então a abertura não refaz as consultas. Se o catálogo falhar ou faltar dado, a série continua na fila (nunca some por engano). Tocar num cartão **abre o episódio no aplicativo da Crunchyroll** (pelo link `https://www.crunchyroll.com/watch/<id>`, com o pacote `com.crunchyroll.crunchyroid`; sem o app instalado, abre no navegador). Na aba Episódios cada linha tem um botão de play que faz o mesmo, sem marcar a caixinha de seleção; para ver os episódios de uma série use o botão de lista no card dela em Séries. Some quando há filtro ativo ou no modo de seleção. O botão de ajustes no título troca o **estilo** (Carrossel, Lista ou Destaque, com o primeiro item grande) e o **tamanho** (Pequeno, Médio, Grande); a escolha fica salva no aparelho.
- **Widgets na tela inicial (Android/Samsung):** três widgets em *Widgets → CrunchySync*: **Destaque** (o lançamento mais novo, grande; 2×2), **Carrossel** (até 6 cartões lado a lado, conforme a largura; 4×2) e **Lista** (até 10 linhas, conforme a altura; 4×3). São redimensionáveis: esticar o widget mostra mais itens. Mostram a mesma fila "Continuar assistindo" (lançamentos mais novos primeiro), com miniatura, progresso e "Lançado há…"; tocar num item abre o episódio no aplicativo da Crunchyroll (tocar no título abre o CrunchySync). Os widgets só leem a última lista que o app guardou (nunca falam com a Crunchyroll), então se atualizam quando o app atualiza o histórico, e o "há N dias" é redesenhado a cada 30 min. Plugin `HomeWidget` em `app/android/.../HomeWidgetPlugin.java`.
- **Fonte da fila:** a lista "Continuar assistindo" da própria Crunchyroll (`/content/v2/discover/{conta}/watchlist`: o próximo episódio de cada série que você está vendo; séries terminadas ou em dia, filmes e séries nunca começadas ficam de fora), ordenada pelo lançamento do episódio. Se essa lista não responder no formato esperado, o app monta a fila a partir do histórico (plano B). O Diagnóstico mostra qual fonte está valendo e o botão **Atualizar os widgets agora** roda a busca em segundo plano e registra o resultado (fonte, última atualização, erro).
- **Atualização sozinha (sem abrir o app):** o Android atualiza os widgets em segundo plano a cada ~30 min (`RefreshJobService`) e também quando redesenha os widgets; cada widget tem um botão ⟳ para atualizar na hora e mostra "Atualizado há…" (ou "Entre de novo no app" se a sessão da Crunchyroll caiu). A busca roda num WebView escondido (a mesma sessão e o mesmo cookie do Cloudflare do app) que executa `bg-sync.js`, gerado por `npm run build:bg` a partir do mesmo TypeScript do app (`src/app/bg-sync.ts`: histórico, próximo episódio, fila), então a lógica é única e testada. O Android pode espaçar esses trabalhos em apps pouco usados; o botão ⟳ garante a atualização manual. Dentro do app, voltar do segundo plano atualiza sozinho se a lista tem mais de 3 min.
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
