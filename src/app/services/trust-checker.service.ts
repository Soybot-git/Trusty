import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { CheckResult, TrustResult } from '../models';
import { ScoringService } from './scoring.service';
import { environment } from '../../environments/environment';

// Cache configuration
const CACHE_PREFIX = 'trusty_cache_';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface CacheEntry {
  result: TrustResult;
  timestamp: number;
}

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
    const domain = this.extractDomain(normalizedUrl);

    // Check localStorage cache first
    const cached = this.getCachedResult(domain);
    if (cached) {
      console.log(`Client cache HIT: ${domain}`);
      return of(cached);
    }
    console.log(`Client cache MISS: ${domain}`);

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
      map((results) => this.scoringService.calculateScore(normalizedUrl, results)),
      tap((result) => this.setCachedResult(domain, result))
    );
  }

  /**
   * Get cached result from localStorage
   */
  private getCachedResult(domain: string): TrustResult | null {
    try {
      const key = CACHE_PREFIX + domain.toLowerCase();
      const cached = localStorage.getItem(key);

      if (!cached) {
        return null;
      }

      const entry: CacheEntry = JSON.parse(cached);
      const now = Date.now();

      // Check if cache is still valid
      if (now - entry.timestamp > CACHE_TTL_MS) {
        localStorage.removeItem(key);
        return null;
      }

      return entry.result;
    } catch (error) {
      console.error('Cache read error:', error);
      return null;
    }
  }

  /**
   * Save result to localStorage cache
   */
  private setCachedResult(domain: string, result: TrustResult): void {
    try {
      const key = CACHE_PREFIX + domain.toLowerCase();
      const entry: CacheEntry = {
        result,
        timestamp: Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(entry));
      console.log(`Client cache SET: ${domain}`);
    } catch (error) {
      console.error('Cache write error:', error);
      // localStorage might be full, try to clean old entries
      this.cleanOldCacheEntries();
    }
  }

  /**
   * Clean old cache entries to free up space
   */
  private cleanOldCacheEntries(): void {
    try {
      const now = Date.now();
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CACHE_PREFIX)) {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry: CacheEntry = JSON.parse(cached);
            if (now - entry.timestamp > CACHE_TTL_MS) {
              keysToRemove.push(key);
            }
          }
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.error('Cache cleanup error:', error);
    }
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
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
    // Weight distribution:
    // Safe Browsing: 0% (preliminary filter only, blocks if malware)
    // WHOIS: 10%
    // SSL: 10%
    // Heuristics: 10%
    // IPQS: 30%
    // Reviews: 40%
    const weights: Record<string, number> = {
      'safe-browsing': 0,
      whois: 10,
      ssl: 10,
      ipqs: 30,
      reviews: 40,
      heuristics: 10,
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
