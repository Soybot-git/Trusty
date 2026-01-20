import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { CheckResult, CheckStatus, IPQSDetails } from '../../models';
import { getScenarioForUrl } from './mock-data';

@Injectable({
  providedIn: 'root',
})
export class MockIpqsService {
  check(url: string): Observable<CheckResult> {
    const scenario = getScenarioForUrl(url);
    const latency = 250 + Math.random() * 400;

    const fraudScore = scenario.fraudScore;
    const isHighRisk = fraudScore > 75;
    const isMediumRisk = fraudScore > 50;

    const details: IPQSDetails = {
      fraudScore,
      isProxy: fraudScore > 80 && Math.random() > 0.5,
      isVpn: fraudScore > 70 && Math.random() > 0.6,
      isTor: fraudScore > 85 && Math.random() > 0.8,
      recentAbuse: fraudScore > 60,
    };

    let status: CheckStatus;
    let score: number;
    let message: string;

    if (isHighRisk) {
      status = 'danger';
      score = 20;
      message = 'Alto rischio di frode rilevato';
    } else if (isMediumRisk) {
      status = 'warning';
      score = 50;
      message = 'Rischio moderato rilevato';
    } else if (fraudScore > 25) {
      status = 'warning';
      score = 70;
      message = 'Rischio basso rilevato';
    } else {
      status = 'safe';
      score = 100 - fraudScore;
      message = 'Nessun rischio significativo';
    }

    const result: CheckResult = {
      type: 'ipqs',
      status,
      score,
      weight: 15,
      message,
      details,
    };

    return of(result).pipe(delay(latency));
  }
}
