import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Injectable, inject, signal } from '@angular/core';
import { coverFileName, hashUrl, keyOf, parseCoverFileName } from './cover-cache';
import { DiagnosticsService } from './diagnostics.service';

const DIR = 'covers';
const CONCURRENCY = 4;

/**
 * Guarda as capas das séries no armazenamento do aparelho. Assim elas abrem na hora, sem
 * baixar de novo e sem depender do cache do navegador embutido (que o Android limpa à vontade).
 * Se o download falhar, o app continua usando o endereço remoto da imagem.
 */
@Injectable({ providedIn: 'root' })
export class CoverCacheService {
  private readonly diag = inject(DiagnosticsService);
  private readonly native = Capacitor.isNativePlatform();

  /** true quando já se sabe quais capas existem no disco (evita carregar a imagem duas vezes). */
  readonly ready = signal(!this.native);
  /** chave da série -> endereço local da capa salva. */
  readonly local = signal<Record<string, string>>({});

  private readonly hashes = new Map<string, string>();
  private syncing = false;
  private pending: Record<string, string> | null = null;

  /** Lê do disco as capas já salvas. */
  async init(): Promise<void> {
    if (!this.native) return;
    try {
      await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true }).catch(
        () => undefined,
      );
      const { files } = await Filesystem.readdir({ path: DIR, directory: Directory.Data });
      const found: Record<string, string> = {};
      for (const f of files) {
        const parsed = parseCoverFileName(f.name);
        if (!parsed) continue;
        found[parsed.key] = await this.srcOf(f.name);
        this.hashes.set(parsed.key, parsed.hash);
      }
      this.local.set(found);
      this.diag.log(`capas: ${Object.keys(found).length} salvas no aparelho`);
    } catch (e) {
      this.diag.log(`capas: leitura do disco falhou (${(e as Error).message})`);
    } finally {
      this.ready.set(true);
    }
  }

  /** Baixa para o disco as capas que faltam ou mudaram. `urls`: id da série -> URL da capa. */
  async sync(urls: Record<string, string>): Promise<void> {
    if (!this.native) return;
    if (this.syncing) {
      this.pending = urls; // roda de novo quando o atual terminar
      return;
    }
    const queue = Object.entries(urls).filter(
      ([id, url]) => this.hashes.get(keyOf(id)) !== hashUrl(url),
    );
    if (queue.length === 0) return;
    this.syncing = true;
    let ok = 0;
    let failed = 0;
    let firstError = '';
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          await this.download(item[0], item[1]);
          ok++;
        } catch (e) {
          failed++;
          firstError ||= (e as Error).message;
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      this.syncing = false;
    }
    this.diag.log(
      `capas: ${ok} salvas no aparelho, ${failed} falharam${firstError ? ` (${firstError})` : ''}`,
    );
    const next = this.pending;
    this.pending = null;
    if (next) await this.sync(next);
  }

  private async download(seriesId: string, url: string): Promise<void> {
    const res = await CapacitorHttp.request({
      url,
      method: 'GET',
      responseType: 'blob',
      connectTimeout: 15000,
      readTimeout: 30000,
    });
    const type = String(res.headers?.['Content-Type'] ?? res.headers?.['content-type'] ?? '');
    if (res.status !== 200 || typeof res.data !== 'string' || !type.startsWith('image')) {
      throw new Error(`HTTP ${res.status}${type ? ' ' + type : ''}`);
    }
    const name = coverFileName(seriesId, url);
    await Filesystem.writeFile({
      path: `${DIR}/${name}`,
      data: res.data,
      directory: Directory.Data,
      recursive: true,
    });
    const key = keyOf(seriesId);
    const old = this.hashes.get(key);
    if (old) {
      await Filesystem.deleteFile({
        path: `${DIR}/${key}.${old}.jpg`,
        directory: Directory.Data,
      }).catch(() => undefined);
    }
    this.hashes.set(key, hashUrl(url));
    const src = await this.srcOf(name);
    this.local.update((m) => ({ ...m, [key]: src }));
  }

  private async srcOf(name: string): Promise<string> {
    const { uri } = await Filesystem.getUri({ path: `${DIR}/${name}`, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  }
}
