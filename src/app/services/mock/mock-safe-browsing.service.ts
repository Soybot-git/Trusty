import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { CheckResult, SafeBrowsingDetails } from '../../models';
import { getScenarioForUrl } from './mock-data';

@Injectable({
  providedIn: 'root',
})
export class MockSafeBrowsingService {
  check(url: string): Observable<CheckResult> {
    const scenario = getScenarioForUrl(url);
    const latency = 200 + Math.random() * 400;

    const { isMalware, isPhishing } = scenario.safeBrowsing;
    const threats: string[] = [];

    if (isMalware) threats.push('MALWARE');
    if (isPhishing) threats.push('SOCIAL_ENGINEERING');

    const isSafe = !isMalware && !isPhishing;

    const details: SafeBrowsingDetails = {
      isMalware,
      isPhishing,
      threats,
    };

    let message: string;
    let score: number;

    if (isMalware || isPhishing) {
      message = 'Attenzione: sito segnalato come pericoloso';
      score = 0;
    } else {
      message = 'Nessuna minaccia rilevata';
      score = 100;
    }

    const result: CheckResult = {
      type: 'safe-browsing',
      status: isSafe ? 'safe' : 'danger',
      score,
      weight: 25,
      message,
      details,
    };

    return of(result).pipe(delay(latency));
  }
}
