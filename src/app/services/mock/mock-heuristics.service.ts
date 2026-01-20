import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { CheckResult, CheckStatus, HeuristicsDetails } from '../../models';
import { extractDomain, getScenarioForUrl, getTld } from './mock-data';

@Injectable({
  providedIn: 'root',
})
export class MockHeuristicsService {
  check(url: string): Observable<CheckResult> {
    const scenario = getScenarioForUrl(url);
    const latency = 100 + Math.random() * 200;

    const domain = extractDomain(url);
    const tld = getTld(domain);
    const hasVat = scenario.hasVat;
    const hasCryptoOnly = scenario.hasCryptoOnly;

    // Simulate payment methods based on scenario
    const paymentMethods = hasCryptoOnly
      ? ['Bitcoin', 'USDT']
      : hasVat
        ? ['PayPal', 'Carta di credito', 'Bonifico']
        : ['PayPal', 'Carta di credito'];

    const details: HeuristicsDetails = {
      hasVatNumber: hasVat,
      vatNumber: hasVat ? this.generateFakeVat() : undefined,
      domainTld: tld,
      hasPrivacyPolicy: !hasCryptoOnly && Math.random() > 0.2,
      hasTerms: !hasCryptoOnly && Math.random() > 0.3,
      hasReturnPolicy: hasVat && Math.random() > 0.2,
      paymentMethods,
      suspiciousPayments: hasCryptoOnly,
    };

    // Calculate score based on heuristics
    let score = 50; // Base score

    // TLD bonus/penalty
    if (tld === 'it') score += 10;
    else if (['com', 'eu', 'net', 'org'].includes(tld)) score += 5;
    else if (['ru', 'cn', 'tk', 'ml'].includes(tld)) score -= 20;

    // VAT bonus
    if (hasVat) score += 15;

    // Legal pages bonus
    if (details.hasPrivacyPolicy) score += 5;
    if (details.hasTerms) score += 5;
    if (details.hasReturnPolicy) score += 10;

    // Payment method penalty
    if (hasCryptoOnly) score -= 30;

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    let status: CheckStatus;
    let message: string;

    if (hasCryptoOnly) {
      status = 'danger';
      message = 'Solo pagamenti in criptovaluta';
    } else if (!hasVat && tld !== 'it') {
      status = 'warning';
      message = 'P.IVA non rilevata';
    } else if (hasVat && details.hasReturnPolicy) {
      status = 'safe';
      message = 'Dati aziendali presenti';
    } else {
      status = 'warning';
      message = 'Verificare dati aziendali';
    }

    const result: CheckResult = {
      type: 'heuristics',
      status,
      score,
      weight: 10,
      message,
      details,
    };

    return of(result).pipe(delay(latency));
  }

  private generateFakeVat(): string {
    // Generate fake Italian VAT (P.IVA) format: IT + 11 digits
    const digits = Array(11)
      .fill(0)
      .map(() => Math.floor(Math.random() * 10))
      .join('');
    return `IT${digits}`;
  }
}
