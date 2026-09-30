import { Injectable, signal } from '@angular/core';

const KEY_TOKEN = 'crunchysync.token';
const KEY_API = 'crunchysync.apiUrl';

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* armazenamento indisponível: valor vale só na sessão */
  }
}

/** Guarda token e URL do BFF no localStorage do dispositivo. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly token = signal(read(KEY_TOKEN));
  readonly apiUrl = signal(read(KEY_API) || 'http://localhost:3000');

  save(apiUrl: string, token: string): void {
    // Aceita o token colado com ou sem o prefixo "Bearer ".
    const clean = token.trim().replace(/^Bearer\s+/i, '');
    const url = apiUrl.trim().replace(/\/+$/, '');
    this.token.set(clean);
    this.apiUrl.set(url);
    write(KEY_TOKEN, clean);
    write(KEY_API, url);
  }

  clearToken(): void {
    this.token.set('');
    write(KEY_TOKEN, '');
  }
}
