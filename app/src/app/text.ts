/** "1 série", "3 séries". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias", "há 2 semanas", "há 8 meses", "há 1 ano". */
export function relativeTime(iso: string | null, now = Date.now()): string {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  const min = Math.floor(Math.max(0, now - t) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `há ${w} ${w === 1 ? 'semana' : 'semanas'}`;
  }
  if (days < 365) {
    const m = Math.min(11, Math.floor(days / 30));
    return `há ${m} ${m === 1 ? 'mês' : 'meses'}`;
  }
  const y = Math.floor(days / 365);
  return `há ${y} ${y === 1 ? 'ano' : 'anos'}`;
}
