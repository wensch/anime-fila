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
  /** Temporadas de uma série ({id}); dá a lista completa de episódios, mesmo fora do histórico. */
  seasonsPath: string;
  /** Episódios de uma temporada ({id}). */
  episodesPath: string;
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
  seasonsPath: '/content/v2/cms/series/{id}/seasons',
  episodesPath: '/content/v2/cms/seasons/{id}/episodes',
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
/** Tamanho de página tentado primeiro; se a API recusar (400) ou limitar a 100, volta a PAGE_SIZE. */
export const BIG_PAGE_SIZE = 500;
/**
 * Teto da conferência completa antes de remover. Já se viu a API recusar a página 11 (de 100):
 * ela entrega só uma janela dos episódios mais recentes, e o app guarda o que já viu no aparelho.
 */
export const FULL_SCAN_LIMIT = 5000;
/** Teto de IDs de episódios buscados no catálogo para limpar o que está fora da janela. */
export const MAX_CATALOG_IDS = 3000;
/** Quantos episódios o app guarda no aparelho (histórico acumulado). */
export const ARCHIVE_MAX = 8000;
/** Rodadas extras de remoção: os episódios mais antigos "sobem" na janela depois que os recentes saem. */
export const MAX_REMOVE_ROUNDS = 10;
