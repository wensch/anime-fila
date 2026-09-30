import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DeleteResult, Series } from './series.model';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(SettingsService);

  private get headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.settings.token()}` });
  }

  private url(path: string): string {
    return `${this.settings.apiUrl()}${path}`;
  }

  listSeries(): Promise<Series[]> {
    return firstValueFrom(this.http.get<Series[]>(this.url('/series'), { headers: this.headers }));
  }

  deleteSeries(seriesId: string): Promise<DeleteResult> {
    return firstValueFrom(
      this.http.delete<DeleteResult>(this.url(`/series/${encodeURIComponent(seriesId)}`), {
        headers: this.headers,
      }),
    );
  }
}
