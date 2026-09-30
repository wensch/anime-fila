/**
 * Único lugar com os detalhes da API NÃO oficial da Crunchyroll.
 * Nada aqui foi verificado contra o serviço real: se o login, a listagem ou a
 * exclusão falharem, a tela "Diagnóstico" mostra o erro exato e estes valores
 * podem ser editados em Configurações avançadas. `{account}` e `{id}` são substituídos.
 */
export interface ApiConfig {
  baseUrl: string;
  /** base64("client_id:client_secret") do cliente OAuth usado no login. */
  basicAuth: string;
  mePath: string;
  historyPath: string;
  deletePath: string;
  /** Metadados (com imagens) de séries; {ids} = ids separados por vírgula. */
  objectsPath: string;
  locale: string;
}

export const DEFAULT_CONFIG: ApiConfig = {
  baseUrl: 'https://www.crunchyroll.com',
  // Cliente do site web (client_id "noaihdevm_6iyg0a8l0q", sem secret).
  basicAuth: 'bm9haWhkZXZtXzZpeWcwYThsMHE6',
  mePath: '/accounts/v1/me',
  historyPath: '/content/v2/{account}/watch-history',
  deletePath: '/content/v2/{account}/watch-history/{id}',
  objectsPath: '/content/v2/cms/objects/{ids}',
  locale: 'pt-BR',
};

export const AUTH_PATH = '/auth/v1/token';
export const PAGE_SIZE = 100;
/** Opções do filtro "Carregar até" (episódios do histórico). */
export const EPISODE_LIMITS = [100, 200, 400, 500, 1000, 2000, 5000];
/** Texto de cada opção do seletor (o maior vale como "Tudo"). */
export const limitLabel = (n: number) => (n === 5000 ? 'Tudo (até 5000)' : String(n));
export const DEFAULT_MAX_EPISODES = 500;
export const DELETE_CONCURRENCY = 5;
/** Tentativas extras (com espera crescente) quando a API responde 429 ou 5xx. */
export const MAX_RETRIES = 3;
/** Teto da varredura completa do histórico antes de remover séries. */
export const FULL_SCAN_LIMIT = 5000;
