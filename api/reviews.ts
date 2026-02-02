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

// ==================== TYPES ====================

interface SerperResult {
  organic?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    position?: number;
    rating?: number;
    ratingCount?: number;
    siteLinks?: Array<{ title: string; link: string }>;
  }>;
}

interface ReviewSource {
  name: string;
  rating: number | null;
  totalReviews: number;
  url: string | null;
}

interface AggregatedReviews {
  sources: ReviewSource[];
  aggregatedRating: number | null;
  totalReviews: number;
  sourceCount: number;
}

// ==================== CONFIGURATION ====================

// Review sites to search
const REVIEW_SITES = [
  {
    name: 'Trustpilot',
    urlPattern: /trustpilot\.com\/review\//,
  },
];

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

function parseReviewCount(text: string): number {
  const cleaned = text.toLowerCase().replace(/[,\.]/g, '').replace('reviews', '').replace('recensioni', '').trim();

  if (cleaned.includes('k')) {
    return Math.round(parseFloat(cleaned.replace('k', '')) * 1000);
  }

  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
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

/**
 * Identify which review site a URL belongs to
 */
function identifySource(url: string): typeof REVIEW_SITES[0] | null {
  for (const site of REVIEW_SITES) {
    if (site.urlPattern.test(url)) {
      return site;
    }
  }
  return null;
}

/**
 * Extract rating and review count from a Serper search result
 */
function extractRatingFromResult(result: NonNullable<SerperResult['organic']>[0]): { rating: number | null; totalReviews: number } {
  let rating: number | null = null;
  let totalReviews = 0;

  // Serper provides rating as a direct top-level field
  if (result.rating != null && result.rating >= 1 && result.rating <= 5) {
    rating = result.rating;
  }
  if (result.ratingCount != null) {
    totalReviews = result.ratingCount;
  }

  // Fallback rating: try to extract from snippet text
  if (rating === null && result.snippet) {
    const snippetRating =
      result.snippet.match(/trustscore\s+(\d+[.,]?\d*)/i) ||
      result.snippet.match(/valutazione\s+(\d+[.,]?\d*)/i) ||
      result.snippet.match(/(\d+[.,]?\d*)\s*(?:\/\s*5|su\s*5|out of 5)/i);
    if (snippetRating) {
      const parsed = parseFloat(snippetRating[1].replace(',', '.'));
      if (parsed >= 1 && parsed <= 5) {
        rating = parsed;
      }
    }
  }

  // Fallback review count: extract from snippet
  if (totalReviews === 0 && result.snippet) {
    const snippetReviews =
      // "43.428 persone" (Trustpilot Italian)
      result.snippet.match(/([\d.,]+)\s*persone/i) ||
      // "62 recensioni", "1,234 reviews"
      result.snippet.match(/([\d.,]+k?)\s*recens\w*/i) ||
      result.snippet.match(/([\d.,]+k?)\s*reviews?/i) ||
      // "Recensioni 1029" (number after keyword)
      result.snippet.match(/recens\w*\s+([\d.,]+)/i);
    if (snippetReviews) {
      totalReviews = parseReviewCount(snippetReviews[1]);
    }
  }

  // Also try title for review count: "Amazon.it Recensioni 38"
  if (totalReviews === 0 && result.title) {
    const titleReviews =
      result.title.match(/recens\w*\s+([\d.,]+)/i) ||
      result.title.match(/([\d.,]+k?)\s*recens\w*/i);
    if (titleReviews) {
      totalReviews = parseReviewCount(titleReviews[1]);
    }
  }

  return { rating, totalReviews };
}

// ==================== SEARCH FUNCTION ====================

/**
 * Search all review sites with a single query using plain keywords.
 * Uses 1 API call — avoids advanced operators (site:, OR) that Serper blocks.
 */
async function searchAllReviewSources(domain: string, apiKey: string): Promise<ReviewSource[]> {
  const searchQuery = `${domain} trustpilot recensioni`;

  const sources: ReviewSource[] = [];

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: searchQuery,
        gl: 'it',
        hl: 'it',
        num: 10,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Serper response body:', errorBody);
      throw new Error(`Serper error: ${response.status} - ${errorBody}`);
    }

    const data: SerperResult = await response.json();

    console.log('Serper results for', domain, ':', JSON.stringify(data.organic?.map(r => ({ link: r.link, title: r.title, rating: r.rating, reviews: r.reviews, snippet: r.snippet?.substring(0, 120) }))));

    const foundSites = new Set<string>();

    // Process organic results
    if (data.organic && data.organic.length > 0) {
      for (const result of data.organic) {
        if (!result.link) continue;

        const site = identifySource(result.link);
        if (!site) continue;

        // Skip if we already have data for this source
        if (foundSites.has(site.name)) continue;
        foundSites.add(site.name);

        const { rating, totalReviews } = extractRatingFromResult(result);

        sources.push({
          name: site.name,
          rating,
          totalReviews,
          url: result.link,
        });
      }
    }
  } catch (error) {
    console.error('Error searching review sites:', error);
  }

  return sources;
}

// ==================== AGGREGATION ====================

function aggregateReviews(sources: ReviewSource[]): AggregatedReviews {
  const validSources = sources.filter((s) => s.rating !== null && s.totalReviews > 0);

  if (validSources.length === 0) {
    // Check if we have ratings without review counts
    const sourcesWithRating = sources.filter((s) => s.rating !== null);
    if (sourcesWithRating.length > 0) {
      // Simple average of ratings
      const avgRating = sourcesWithRating.reduce((sum, s) => sum + (s.rating || 0), 0) / sourcesWithRating.length;
      return {
        sources,
        aggregatedRating: Math.round(avgRating * 10) / 10,
        totalReviews: 0,
        sourceCount: sourcesWithRating.length,
      };
    }

    return {
      sources,
      aggregatedRating: null,
      totalReviews: 0,
      sourceCount: 0,
    };
  }

  // Weighted average by number of reviews
  const totalReviews = validSources.reduce((sum, s) => sum + s.totalReviews, 0);
  const weightedSum = validSources.reduce((sum, s) => sum + (s.rating || 0) * s.totalReviews, 0);
  const aggregatedRating = Math.round((weightedSum / totalReviews) * 10) / 10;

  return {
    sources,
    aggregatedRating,
    totalReviews,
    sourceCount: validSources.length,
  };
}

// ==================== SCORING ====================

interface ReviewScore {
  score: number;
  status: string;
  message: string;
  insufficientReviews: boolean;
}

function getScoreFromAggregatedReviews(aggregated: AggregatedReviews): ReviewScore {
  const { aggregatedRating, totalReviews, sourceCount } = aggregated;

  // No reviews found or less than minimum threshold
  if (aggregatedRating === null || totalReviews < MIN_REVIEWS_THRESHOLD) {
    return {
      score: 50,
      status: 'warning',
      message: 'Non ci sono abbastanza recensioni',
      insufficientReviews: true,
    };
  }

  // Build message with source info
  const sourceInfo = sourceCount > 1 ? ` da ${sourceCount} fonti` : '';
  const reviewInfo = ` (${formatReviewCount(totalReviews)} recensioni${sourceInfo})`;

  if (aggregatedRating >= 4.5) {
    return {
      score: 100,
      status: 'safe',
      message: `Eccellente: ${aggregatedRating}/5${reviewInfo}`,
      insufficientReviews: false,
    };
  }

  if (aggregatedRating >= 4.0) {
    return {
      score: 90,
      status: 'safe',
      message: `Molto buono: ${aggregatedRating}/5${reviewInfo}`,
      insufficientReviews: false,
    };
  }

  if (aggregatedRating >= 3.5) {
    return {
      score: 75,
      status: 'safe',
      message: `Buono: ${aggregatedRating}/5${reviewInfo}`,
      insufficientReviews: false,
    };
  }

  if (aggregatedRating >= 3.0) {
    return {
      score: 60,
      status: 'warning',
      message: `Nella media: ${aggregatedRating}/5${reviewInfo}`,
      insufficientReviews: false,
    };
  }

  if (aggregatedRating >= 2.0) {
    return {
      score: 35,
      status: 'warning',
      message: `Valutazione bassa: ${aggregatedRating}/5${reviewInfo}`,
      insufficientReviews: false,
    };
  }

  return {
    score: 15,
    status: 'danger',
    message: `Valutazione pessima: ${aggregatedRating}/5${reviewInfo}`,
    insufficientReviews: false,
  };
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

  const apiKey = process.env['SERPER_API_KEY']?.trim();

  if (!apiKey) {
    console.error('SERPER_API_KEY not configured');
    return res.status(200).json({
      result: {
        type: 'reviews',
        status: 'warning',
        score: 50,
        weight: REVIEWS_WEIGHT,
        message: 'Verifica recensioni non disponibile',
        details: {
          aggregatedRating: null,
          totalReviews: 0,
          sourceCount: 0,
          sources: [],
          insufficientReviews: true,
          error: 'API not configured',
        },
      },
    });
  }

  try {
    // Single combined search for all review sources
    const sources = await searchAllReviewSources(domain, apiKey);

    // Aggregate results
    const aggregated = aggregateReviews(sources);
    const { score, status, message, insufficientReviews } = getScoreFromAggregatedReviews(aggregated);

    // Filter sources for response (only include those with data)
    const sourcesWithData = sources.filter((s) => s.rating !== null || s.url !== null);

    const result: ReviewsResult = {
      type: 'reviews',
      status,
      score,
      weight: REVIEWS_WEIGHT,
      message,
      details: {
        aggregatedRating: aggregated.aggregatedRating,
        totalReviews: aggregated.totalReviews,
        sourceCount: aggregated.sourceCount,
        sources: sourcesWithData.map((s) => ({
          name: s.name,
          rating: s.rating,
          totalReviews: s.totalReviews,
          url: s.url,
        })),
        insufficientReviews,
      },
    };

    // Cache the result
    await setCache(cacheKey, result, CACHE_TTL.REVIEWS);

    return res.status(200).json({ result });
  } catch (error) {
    console.error('Reviews aggregation error:', error);

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
