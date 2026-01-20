import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { CheckResult, CheckStatus, WhoisDetails } from '../../models';
import { getScenarioForUrl } from './mock-data';

@Injectable({
  providedIn: 'root',
})
export class MockWhoisService {
  check(url: string): Observable<CheckResult> {
    const scenario = getScenarioForUrl(url);
    const latency = 300 + Math.random() * 500;

    const domainAgeDays = scenario.domainAgeDays;
    const creationDate = new Date();
    creationDate.setDate(creationDate.getDate() - domainAgeDays);

    const expirationDate = new Date();
    expirationDate.setFullYear(expirationDate.getFullYear() + 1);

    const details: WhoisDetails = {
      domainAge: domainAgeDays,
      registrar: this.getRandomRegistrar(),
      creationDate: creationDate.toISOString().split('T')[0],
      expirationDate: expirationDate.toISOString().split('T')[0],
      country: 'IT',
    };

    let status: CheckStatus;
    let score: number;
    let message: string;

    if (domainAgeDays < 30) {
      status = 'danger';
      score = 20;
      message = `Dominio molto recente (${domainAgeDays} giorni)`;
    } else if (domainAgeDays < 90) {
      status = 'warning';
      score = 50;
      message = `Dominio recente (${Math.floor(domainAgeDays / 30)} mesi)`;
    } else if (domainAgeDays < 365) {
      status = 'warning';
      score = 70;
      message = `Dominio da ${Math.floor(domainAgeDays / 30)} mesi`;
    } else {
      const years = Math.floor(domainAgeDays / 365);
      status = 'safe';
      score = Math.min(100, 80 + years * 2);
      message = `Dominio attivo da ${years} ${years === 1 ? 'anno' : 'anni'}`;
    }

    const result: CheckResult = {
      type: 'whois',
      status,
      score,
      weight: 20,
      message,
      details,
    };

    return of(result).pipe(delay(latency));
  }

  private getRandomRegistrar(): string {
    const registrars = [
      'GoDaddy.com, LLC',
      'Aruba S.p.A.',
      'Register.it S.p.A.',
      'OVH SAS',
      'Namecheap, Inc.',
      'Google LLC',
    ];
    return registrars[Math.floor(Math.random() * registrars.length)];
  }
}
