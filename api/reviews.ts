import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCached, setCache, getCacheKey, CACHE_TTL } from './lib/cache.js';

interface ReviewsResult {
  type: string;
  status: string;
  score: number;
  weight: number;
  message: string;
  details: {
    aggregatedRating: number | null;
    totalReviews: number;
    sourceCount: number;
    sources: Array<{
      name: string;
      rating: number | null;
      totalReviews: number;
      url: string | null;
    }>;
    insufficientReviews: boolean;
    error?: string;
  };
}

// ==================== HELPER FUNCTIONS ====================

function extractDomain(url: string): string {
  try {
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    const urlObj = new URL(normalizedUrl);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }
}

function formatReviewCount(count: number): string {
  if (count >= 10000) {
    return `${Math.round(count / 1000)}k`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`.replace('.0k', 'k');
  }
  return count.toString();
}

// Minimum reviews required to consider reviews valid
const MIN_REVIEWS_THRESHOLD = 20;

// Fixed weight for reviews (30%)
const REVIEWS_WEIGHT = 30;

// ==================== TRUSTPILOT ====================

/**
 * Fetch the Trustpilot review page for a domain and extract rating data from JSON-LD.
 */
async function fetchTrustpilotData(domain: string): Promise<{ rating: number | null; totalReviews: number; url: string }> {
  const trustpilotUrl = `https://it.trustpilot.com/review/${domain}`;

  try {
    const response = await fetch(trustpilotUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
    });

    if (!response.ok) {
      console.error(`Trustpilot page returned ${response.status} for ${domain}`);
      return { rating: null, totalReviews: 0, url: trustpilotUrl };
    }

    const html = await response.text();
    console.log(`Trustpilot page for ${domain}: ${html.length} chars, status ${response.status}`);

    const jsonLdBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    console.log(`JSON-LD blocks found: ${jsonLdBlocks ? jsonLdBlocks.length : 0}`);

    if (!jsonLdBlocks) return { rating: null, totalReviews: 0, url: trustpilotUrl };

    for (const block of jsonLdBlocks) {
      const jsonContent = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
      try {
        const parsed = JSON.parse(jsonContent);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          console.log(`JSON-LD item @type: ${item['@type']}, has aggregateRating: ${!!item.aggregateRating}`);
          const aggRating = item.aggregateRating;
          if (aggRating?.ratingValue) {
            console.log(`Found rating: ${aggRating.ratingValue}, reviewCount: ${aggRating.reviewCount}`);
            return {
              rating: parseFloat(String(aggRating.ratingValue).replace(',', '.')),
              totalReviews: parseInt(String(aggRating.reviewCount || '0'), 10) || 0,
              url: trustpilotUrl,
            };
          }
        }
      } catch (e) {
        console.error('JSON-LD parse error:', e);
      }
    }

    console.log('No aggregateRating found in any JSON-LD block');
    return { rating: null, totalReviews: 0, url: trustpilotUrl };
  } catch (error) {
    console.error('Trustpilot fetch error:', error);
    return { rating: null, totalReviews: 0, url: trustpilotUrl };
  }
}

// ==================== SCORING ====================

interface ReviewScore {
  score: number;
  status: string;
  message: string;
  insufficientReviews: boolean;
}

function getScoreFromReviewData(rating: number | null, totalReviews: number): ReviewScore {
  if (rating === null || totalReviews < MIN_REVIEWS_THRESHOLD) {
    return {
      score: 50,
      status: 'warning',
      message: 'Non ci sono abbastanza recensioni',
      insufficientReviews: true,
    };
  }

  const reviewInfo = ` (${formatReviewCount(totalReviews)} recensioni)`;

  if (rating >= 4.5) {
    return { score: 100, status: 'safe', message: `Eccellente: ${rating}/5${reviewInfo}`, insufficientReviews: false };
  }
  if (rating >= 4.0) {
    return { score: 90, status: 'safe', message: `Molto buono: ${rating}/5${reviewInfo}`, insufficientReviews: false };
  }
  if (rating >= 3.5) {
    return { score: 75, status: 'safe', message: `Buono: ${rating}/5${reviewInfo}`, insufficientReviews: false };
  }
  if (rating >= 3.0) {
    return { score: 60, status: 'warning', message: `Nella media: ${rating}/5${reviewInfo}`, insufficientReviews: false };
  }
  if (rating >= 2.0) {
    return { score: 35, status: 'warning', message: `Valutazione bassa: ${rating}/5${reviewInfo}`, insufficientReviews: false };
  }
  return { score: 15, status: 'danger', message: `Valutazione pessima: ${rating}/5${reviewInfo}`, insufficientReviews: false };
}

// ==================== MAIN HANDLER ====================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const domain = extractDomain(url);
  const cacheKey = getCacheKey('reviews', domain);

  // Check cache first
  const cached = await getCached<ReviewsResult>(cacheKey);
  if (cached) {
    return res.status(200).json({ result: cached });
  }

  try {
    const { rating, totalReviews, url: trustpilotUrl } = await fetchTrustpilotData(domain);
    const { score, status, message, insufficientReviews } = getScoreFromReviewData(rating, totalReviews);

    const result: ReviewsResult = {
      type: 'reviews',
      status,
      score,
      weight: REVIEWS_WEIGHT,
      message,
      details: {
        aggregatedRating: rating,
        totalReviews,
        sourceCount: rating !== null ? 1 : 0,
        sources: rating !== null ? [{ name: 'Trustpilot', rating, totalReviews, url: trustpilotUrl }] : [],
        insufficientReviews,
      },
    };

    // Cache the result
    await setCache(cacheKey, result, CACHE_TTL.REVIEWS);

    return res.status(200).json({ result });
  } catch (error) {
    console.error('Reviews error:', error);

    return res.status(200).json({
      result: {
        type: 'reviews',
        status: 'warning',
        score: 50,
        weight: REVIEWS_WEIGHT,
        message: 'Impossibile verificare recensioni',
        details: {
          aggregatedRating: null,
          totalReviews: 0,
          sourceCount: 0,
          sources: [],
          insufficientReviews: true,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
    });
  }
}
