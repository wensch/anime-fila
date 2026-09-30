import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.crunchysync.app',
  appName: 'CrunchySync',
  webDir: 'dist/app/browser',
  // O BFF costuma rodar em HTTP na rede local; sem isso o WebView bloqueia
  // as chamadas (conteúdo misto) a partir do esquema https padrão.
  server: { androidScheme: 'http', cleartext: true },
};

export default config;
