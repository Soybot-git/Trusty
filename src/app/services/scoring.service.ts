import { Injectable } from '@angular/core';
import {
  CheckResult,
  TrustResult,
  TrustBullet,
  getTrustLevel,
  SafeBrowsingDetails,
  WhoisDetails,
  HeuristicsDetails,
  CheckDetails,
} from '../models';
import { extractDomain } from './mock/mock-data';

// Type guards for details
function isSafeBrowsingDetails(details: CheckDetails | undefined): details is SafeBrowsingDetails {
  return details !== undefined && 'isMalware' in details && 'isPhishing' in details;
}

function isWhoisDetails(details: CheckDetails | undefined): details is WhoisDetails {
  return details !== undefined && 'domainAge' in details && 'registrar' in details;
}

function isHeuristicsDetails(details: CheckDetails | undefined): details is HeuristicsDetails {
  return details !== undefined && 'suspiciousPayments' in details && 'hasVatNumber' in details;
}

interface ReviewsDetailsWithInsufficient {
  insufficientReviews?: boolean;
  totalReviews?: number;
}

function hasInsufficientReviews(details: CheckDetails | undefined): boolean {
  if (!details) return true;
  const reviewDetails = details as ReviewsDetailsWithInsufficient;
  return reviewDetails.insufficientReviews === true || (reviewDetails.totalReviews !== undefined && reviewDetails.totalReviews < 20);
}

@Injectable({
  providedIn: 'root',
})
export class ScoringService {
  /**
   * Calculate final trust score from all check results
   *
   * Weight distribution:
   * - WHOIS: 10%
   * - SSL: 10%
   * - Heuristics: 10%
   * - IPQS: 30%
   * - Reviews: 40%
   * - Safe Browsing: 0% (filter only)
   */
  calculateScore(url: string, checks: CheckResult[]): TrustResult {
    const domain = extractDomain(url);

    // Check for critical overrides first
    const safeBrowsingCheck = checks.find((c) => c.type === 'safe-browsing');
    const whoisCheck = checks.find((c) => c.type === 'whois');
    const heuristicsCheck = checks.find((c) => c.type === 'heuristics');
    const reviewsCheck = checks.find((c) => c.type === 'reviews');

    // Override: Malware detected = score 0
    if (safeBrowsingCheck && isSafeBrowsingDetails(safeBrowsingCheck.details)) {
      if (safeBrowsingCheck.details.isMalware || safeBrowsingCheck.details.isPhishing) {
        return this.createResult(url, domain, 0, checks);
      }
    }

    // Calculate weighted score
    let totalWeight = 0;
    let weightedScore = 0;

    for (const check of checks) {
      weightedScore += check.score * (check.weight / 100);
      totalWeight += check.weight;
    }

    // Normalize if weights don't sum to 100
    let finalScore = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 50;

    // Apply dynamic penalties
    // Domain < 30 days = max score 50
    if (whoisCheck && isWhoisDetails(whoisCheck.details)) {
      if (whoisCheck.details.domainAge < 30) {
        finalScore = Math.min(finalScore, 50);
      }
    }

    // Crypto-only payments = -20 points
    if (heuristicsCheck && isHeuristicsDetails(heuristicsCheck.details)) {
      if (heuristicsCheck.details.suspiciousPayments) {
        finalScore = Math.max(0, finalScore - 20);
      }
    }

    // Insufficient reviews (< 20) = max score 60
    if (reviewsCheck && hasInsufficientReviews(reviewsCheck.details)) {
      finalScore = Math.min(finalScore, 60);
    }

    return this.createResult(url, domain, Math.round(finalScore), checks);
  }

  private createResult(
    url: string,
    domain: string,
    score: number,
    checks: CheckResult[]
  ): TrustResult {
    return {
      url,
      domain,
      score,
      level: getTrustLevel(score),
      bullets: this.generateBullets(checks),
      details: checks,
      checkedAt: new Date(),
    };
  }

  /**
   * Generate up to 4 bullet points summarizing the checks
   */
  private generateBullets(checks: CheckResult[]): TrustBullet[] {
    const bullets: TrustBullet[] = [];

    // Priority order for bullets
    const priorityOrder: Array<{ type: string; priority: number }> = [
      { type: 'safe-browsing', priority: 1 },
      { type: 'whois', priority: 2 },
      { type: 'ssl', priority: 3 },
      { type: 'reviews', priority: 4 },
      { type: 'ipqs', priority: 5 },
      { type: 'heuristics', priority: 6 },
    ];

    // Sort checks by status (danger first, then warning, then safe)
    const sortedChecks = [...checks].sort((a, b) => {
      const statusOrder = { danger: 0, warning: 1, unknown: 2, safe: 3 };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;

      // If same status, sort by priority
      const aPriority = priorityOrder.find((p) => p.type === a.type)?.priority || 99;
      const bPriority = priorityOrder.find((p) => p.type === b.type)?.priority || 99;
      return aPriority - bPriority;
    });

    // Take top 4 most relevant
    for (const check of sortedChecks.slice(0, 4)) {
      bullets.push({
        icon: this.getIconForStatus(check.status),
        text: check.message,
      });
    }

    return bullets;
  }

  private getIconForStatus(status: string): 'check' | 'warning' | 'danger' {
    switch (status) {
      case 'safe':
        return 'check';
      case 'warning':
        return 'warning';
      case 'danger':
        return 'danger';
      default:
        return 'warning';
    }
  }
}
