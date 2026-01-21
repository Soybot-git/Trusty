import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { CheckResult, TrustResult } from '../models';
import { ScoringService } from './scoring.service';
import { environment } from '../../environments/environment';

// Mock services
import {
  MockSafeBrowsingService,
  MockWhoisService,
  MockSslService,
  MockIpqsService,
  MockReviewsService,
  MockHeuristicsService,
} from './mock';

// Real services
import {
  SafeBrowsingService,
  WhoisService,
  SslService,
  IpqsService,
  ReviewsService,
  HeuristicsService,
} from './api';

@Injectable({
  providedIn: 'root',
})
export class TrustCheckerService {
  private scoringService = inject(ScoringService);

  // Mock services
  private mockSafeBrowsing = inject(MockSafeBrowsingService);
  private mockWhois = inject(MockWhoisService);
  private mockSsl = inject(MockSslService);
  private mockIpqs = inject(MockIpqsService);
  private mockReviews = inject(MockReviewsService);
  private mockHeuristics = inject(MockHeuristicsService);

  // Real services
  private realSafeBrowsing = inject(SafeBrowsingService);
  private realWhois = inject(WhoisService);
  private realSsl = inject(SslService);
  private realIpqs = inject(IpqsService);
  private realReviews = inject(ReviewsService);
  private realHeuristics = inject(HeuristicsService);

  /**
   * Run all checks on a URL and return the aggregated trust result
   */
  check(url: string): Observable<TrustResult> {
    const normalizedUrl = this.normalizeUrl(url);

    // Get the appropriate service based on environment
    const useMocks = environment.useMocks;

    const checks$: Observable<CheckResult>[] = [
      this.runCheck(
        useMocks
          ? this.mockSafeBrowsing.check(normalizedUrl)
          : this.realSafeBrowsing.check(normalizedUrl),
        'safe-browsing'
      ),
      this.runCheck(
        useMocks
          ? this.mockWhois.check(normalizedUrl)
          : this.realWhois.check(normalizedUrl),
        'whois'
      ),
      this.runCheck(
        useMocks ? this.mockSsl.check(normalizedUrl) : this.realSsl.check(normalizedUrl),
        'ssl'
      ),
      this.runCheck(
        useMocks
          ? this.mockIpqs.check(normalizedUrl)
          : this.realIpqs.check(normalizedUrl),
        'ipqs'
      ),
      this.runCheck(
        useMocks
          ? this.mockReviews.check(normalizedUrl)
          : this.realReviews.check(normalizedUrl),
        'reviews'
      ),
      this.runCheck(
        useMocks
          ? this.mockHeuristics.check(normalizedUrl)
          : this.realHeuristics.check(normalizedUrl),
        'heuristics'
      ),
    ];

    return forkJoin(checks$).pipe(
      map((results) => this.scoringService.calculateScore(normalizedUrl, results))
    );
  }

  /**
   * Wrap a check with error handling
   */
  private runCheck(
    check$: Observable<CheckResult>,
    type: string
  ): Observable<CheckResult> {
    return check$.pipe(
      catchError((error) => {
        console.error(`Error in ${type} check:`, error);
        return of(this.createErrorResult(type));
      })
    );
  }

  /**
   * Create a fallback result when a check fails
   */
  private createErrorResult(type: string): CheckResult {
    return {
      type: type as CheckResult['type'],
      status: 'unknown',
      score: 50, // Neutral score for failed checks
      weight: this.getWeightForType(type),
      message: 'Verifica non disponibile',
      details: { error: true },
    };
  }

  private getWeightForType(type: string): number {
    // Updated weights for the new scoring system:
    // Safe Browsing: 0% (preliminary filter only, blocks if malware)
    // WHOIS: 15% (fixed)
    // SSL: 15% (fixed)
    // Heuristics: 15% (fixed)
    // Reviews: 10-30% (dynamic based on review count, default 10)
    // IPQS: 45-25% (complementary to reviews: 55 - reviewsWeight)
    const weights: Record<string, number> = {
      'safe-browsing': 0,
      whois: 15,
      ssl: 15,
      ipqs: 45, // Default max when reviews weight is minimum
      reviews: 10, // Default minimum
      heuristics: 15,
    };
    return weights[type] || 10;
  }

  /**
   * Normalize URL to ensure consistent format
   */
  private normalizeUrl(url: string): string {
    let normalized = url.trim();

    // Add protocol if missing
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }

    return normalized;
  }
}
