import { createApp } from './app.js';
import { createCrunchyrollClient } from './crunchyroll.js';

const env = process.env;
const overrides = Object.fromEntries(
  Object.entries({
    baseUrl: env.CR_BASE_URL,
    mePath: env.CR_ME_PATH,
    historyPath: env.CR_HISTORY_PATH,
    deletePath: env.CR_DELETE_PATH,
    locale: env.CR_LOCALE,
    userAgent: env.CR_USER_AGENT,
  }).filter(([, v]) => v),
);

const port = Number(env.PORT ?? 3000);
createApp({ client: createCrunchyrollClient(overrides) }).listen(port, () =>
  console.log(`CrunchySync BFF ouvindo na porta ${port}`),
);
