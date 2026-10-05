export interface Episode {
  episodeId: string;
  seriesId: string;
  seriesTitle: string;
  episodeTitle: string | null;
  episodeNumber: number | null;
  coverUrl: string | null;
  /** ISO 8601 ou null se a API não informou. */
  watchedAt: string | null;
}

export interface Series {
  seriesId: string;
  title: string;
  coverUrl: string | null;
  episodeCount: number;
  lastWatchedAt: string | null;
  episodeIds: string[];
}

export interface DeleteOutcome {
  deleted: string[];
  /** Já não existiam no histórico (404): contam como removidos. */
  missing?: string[];
  failed: { id: string; error: string }[];
  /** true se o usuário cancelou antes de terminar. */
  cancelled?: boolean;
  /** true se a sessão caiu no meio: `deleted` traz o que já foi apagado antes disso. */
  expired?: boolean;
}
