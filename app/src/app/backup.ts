import { Episode } from './models';

const pad = (n: number) => String(n).padStart(2, '0');

/** Escapa um campo CSV (RFC 4180): aspas duplicadas, campo entre aspas se preciso. */
function cell(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV com BOM (abre com acentos certos no Excel/Planilhas). */
export function buildCsv(episodes: Episode[]): string {
  const header = [
    'Série',
    'Episódio',
    'Título do episódio',
    'Assistido em',
    'ID do episódio',
    'ID da série',
  ];
  const rows = episodes.map((e) => [
    e.seriesTitle,
    e.episodeNumber,
    e.episodeTitle,
    e.watchedAt,
    e.episodeId,
    e.seriesId,
  ]);
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function backupFileName(now = new Date()): string {
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `crunchysync-copia-${d}-${t}.csv`;
}
