import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { CheckResult, CheckStatus, ReviewsDetails } from '../../models';
import { extractDomain, getScenarioForUrl } from './mock-data';

@Injectable({
  providedIn: 'root',
})
export class MockReviewsService {
  check(url: string): Observable<CheckResult> {
    const scenario = getScenarioForUrl(url);
    const latency = 400 + Math.random() * 400;

    const rating = Math.round(scenario.reviewRating * 10) / 10;
    const totalReviews = scenario.reviewCount;
    const domain = extractDomain(url);

    const details: ReviewsDetails = {
      rating,
      totalReviews,
      source: 'Trustpilot',
      url: `https://www.trustpilot.com/review/${domain}`,
    };

    let status: CheckStatus;
    let score: number;
    let message: string;

    if (totalReviews < 10) {
      status = 'warning';
      score = 50;
      message = 'Poche recensioni disponibili';
    } else if (rating >= 4.0) {
      status = 'safe';
      score = Math.min(100, Math.round(rating * 20));
      message = `Valutazione ${rating}/5 (${this.formatReviewCount(totalReviews)} recensioni)`;
    } else if (rating >= 3.0) {
      status = 'warning';
      score = Math.round(rating * 15);
      message = `Valutazione ${rating}/5 (${this.formatReviewCount(totalReviews)} recensioni)`;
    } else if (rating >= 2.0) {
      status = 'warning';
      score = Math.round(rating * 12);
      message = `Valutazione bassa: ${rating}/5`;
    } else {
      status = 'danger';
      score = Math.round(rating * 10);
      message = `Valutazione molto bassa: ${rating}/5`;
    }

    const result: CheckResult = {
      type: 'reviews',
      status,
      score,
      weight: 20,
      message,
      details,
    };

    return of(result).pipe(delay(latency));
  }

  private formatReviewCount(count: number): string {
    if (count >= 1000) {
      return `${Math.round(count / 1000)}k`;
    }
    return count.toString();
  }
}
