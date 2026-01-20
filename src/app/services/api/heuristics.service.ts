import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CheckResult } from '../../models';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class HeuristicsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/heuristics`;

  check(url: string): Observable<CheckResult> {
    return this.http
      .post<{ result: CheckResult }>(this.apiUrl, { url })
      .pipe(map((response) => response.result));
  }
}
