/** Hash curto e estável (djb2) da URL da capa: muda quando a Crunchyroll troca a imagem. */
export function hashUrl(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Id da série seguro para nome de arquivo. */
export function keyOf(seriesId: string): string {
  return seriesId.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function coverFileName(seriesId: string, url: string): string {
  return `${keyOf(seriesId)}.${hashUrl(url)}.jpg`;
}

/** Inverso de coverFileName: devolve a chave da série e o hash da URL salva. */
export function parseCoverFileName(name: string): { key: string; hash: string } | null {
  const m = /^([A-Za-z0-9_-]+)\.([0-9a-z]+)\.jpg$/.exec(name);
  return m ? { key: m[1], hash: m[2] } : null;
}
