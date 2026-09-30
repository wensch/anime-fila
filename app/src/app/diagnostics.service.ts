import { Injectable, signal } from '@angular/core';

export interface LogEntry {
  at: string;
  line: string;
}

const MAX = 60;

/**
 * Registro das chamadas de rede para depuração no celular (tela "Diagnóstico").
 * Nunca recebe senhas, tokens ou corpos de requisição: só método, caminho, status e erro.
 */
@Injectable({ providedIn: 'root' })
export class DiagnosticsService {
  readonly entries = signal<LogEntry[]>([]);

  log(line: string): void {
    const entry = { at: new Date().toISOString().slice(11, 19), line };
    this.entries.update((list) => [entry, ...list].slice(0, MAX));
  }

  clear(): void {
    this.entries.set([]);
  }

  asText(): string {
    return this.entries()
      .map((e) => `${e.at} ${e.line}`)
      .reverse()
      .join('\n');
  }
}
