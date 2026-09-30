import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Injectable } from '@angular/core';
import { backupFileName, buildCsv } from './backup';
import { Episode } from './models';

/** Gera uma cópia (CSV) dos episódios e abre o menu Compartilhar para salvar/enviar. */
@Injectable({ providedIn: 'root' })
export class BackupService {
  async save(episodes: Episode[]): Promise<void> {
    const name = backupFileName();
    const csv = buildCsv(episodes);
    if (Capacitor.isNativePlatform()) {
      const file = await Filesystem.writeFile({
        path: name,
        data: csv,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({
        title: 'Cópia do histórico',
        dialogTitle: 'Salvar cópia do histórico',
        files: [file.uri],
      });
    } else {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }
}
