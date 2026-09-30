export interface Series {
  seriesId: string;
  title: string;
  coverUrl: string | null;
  episodeCount: number;
  lastWatchedAt: string | null;
  episodeIds: string[];
}

export interface DeleteResult {
  seriesId: string;
  requested: number;
  deleted: number;
  failed: { id: string; error: string }[];
}
