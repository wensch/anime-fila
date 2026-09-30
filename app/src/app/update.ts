/** Repositório de onde vêm as versões (release fixa "apk-latest"). */
export const REPO = 'wensch/anime-fila';
export const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/tags/apk-latest`;
export const APK_URL = `https://github.com/${REPO}/releases/download/apk-latest/CrunchySync.apk`;

/** Lê "Build #12 do commit …" do texto da release. */
export function parseBuildNumber(body: unknown): number | null {
  const m = /Build\s*#(\d+)/i.exec(typeof body === 'string' ? body : '');
  return m ? Number(m[1]) : null;
}

/** Há versão nova? Build local (0) nunca pergunta. */
export function isNewer(remote: number | null, current: number): boolean {
  return current > 0 && remote !== null && remote > current;
}
