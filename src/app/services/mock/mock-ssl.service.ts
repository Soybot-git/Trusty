import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { CheckResult, SSLDetails } from '../../models';
import { getScenarioForUrl } from './mock-data';

@Injectable({
  providedIn: 'root',
})
export class MockSslService {
  check(url: string): Observable<CheckResult> {
    const scenario = getScenarioForUrl(url);
    const latency = 150 + Math.random() * 300;

    const isValid = scenario.sslValid;
    const daysUntilExpiry = isValid ? Math.floor(Math.random() * 300) + 30 : 0;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysUntilExpiry);

    const details: SSLDetails = {
      isValid,
      issuer: isValid ? this.getRandomIssuer() : 'N/A',
      expiresAt: isValid ? expiresAt.toISOString().split('T')[0] : 'N/A',
      daysUntilExpiry,
    };

    let message: string;
    let score: number;

    if (!isValid) {
      message = 'Certificato SSL non valido o assente';
      score = 0;
    } else if (daysUntilExpiry < 30) {
      message = 'Certificato SSL in scadenza';
      score = 70;
    } else {
      message = 'Certificato SSL valido';
      score = 100;
    }

    const result: CheckResult = {
      type: 'ssl',
      status: isValid ? 'safe' : 'danger',
      score,
      weight: 10,
      message,
      details,
    };

    return of(result).pipe(delay(latency));
  }

  private getRandomIssuer(): string {
    const issuers = [
      "Let's Encrypt",
      'DigiCert Inc',
      'Sectigo Limited',
      'GlobalSign',
      'Comodo CA',
    ];
    return issuers[Math.floor(Math.random() * issuers.length)];
  }
}
