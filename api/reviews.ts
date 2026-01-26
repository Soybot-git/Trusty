import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCached, setCache, getCacheKey, CACHE_TTL } from './lib/cache';

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

interface SerpApiResult {
  organic_results?: Array<{
    link?: string;
    title?: string;
    snippet?: string;
    rich_snippet?: {
      top?: {
        detected_extensions?: {
          rating?: number;
          reviews?: number;
        };
        extensions?: string[];
      };
    };
  }>;
  error?: string;
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

// Review sites to search (order matters - first match wins for each site)
const REVIEW_SITES = [
  {
    name: 'Trustpilot',
    urlPattern: /trustpilot\.com\/review\//,
    siteQuery: 'site:trustpilot.com',
  },
  {
    name: 'Recensioni Verificate',
    urlPattern: /recensioni-verificate\.com/,
    siteQuery: 'site:recensioni-verificate.com',
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
 * Extract rating and review count from a search result
 */
function extractRatingFromResult(result: SerpApiResult['organic_results'][0]): { rating: number | null; totalReviews: number } {
  let rating: number | null = null;
  let totalReviews = 0;

  // Try to get rating from rich snippet detected_extensions
  if (result.rich_snippet?.top?.detected_extensions) {
    const ext = result.rich_snippet.top.detected_extensions;
    if (ext.rating && ext.rating >= 1 && ext.rating <= 5) {
      rating = ext.rating;
    }
    if (ext.reviews) {
      totalReviews = ext.reviews;
    }
  }

  // Try to parse from extensions array
  if (rating === null && result.rich_snippet?.top?.extensions) {
    for (const ext of result.rich_snippet.top.extensions) {
      // Look for rating patterns
      const ratingMatch = ext.match(/(\d+[.,]?\d*)\s*(\/\s*5|stars?|stelle)?/i);
      if (ratingMatch && !ext.toLowerCase().includes('review') && !ext.toLowerCase().includes('recens')) {
        const parsed = parseFloat(ratingMatch[1].replace(',', '.'));
        if (parsed >= 1 && parsed <= 5) {
          rating = parsed;
        }
      }
      // Look for review count
      const reviewMatch = ext.match(/(\d+[\d,\.]*k?)\s*(review|recens)/i);
      if (reviewMatch) {
        totalReviews = parseReviewCount(reviewMatch[1]);
      }
    }
  }

  // Try to extract from snippet text
  if (rating === null && result.snippet) {
    const snippetRating = result.snippet.match(/(\d+[.,]?\d*)\s*\/\s*5/);
    if (snippetRating) {
      rating = parseFloat(snippetRating[1].replace(',', '.'));
    }
  }

  // Also try to find review count in snippet
  if (totalReviews === 0 && result.snippet) {
    const snippetReviews = result.snippet.match(/(\d+[\d,\.]*k?)\s*(review|recens)/i);
    if (snippetReviews) {
      totalReviews = parseReviewCount(snippetReviews[1]);
    }
  }

  return { rating, totalReviews };
}

// ==================== SEARCH FUNCTION ====================

/**
 * Search all review sites with a single combined OR query
 * Uses 1 API call for all review sites
 */
async function searchAllReviewSources(domain: string, apiKey: string): Promise<ReviewSource[]> {
  // Build combined OR query for all review sites
  const sitesQuery = REVIEW_SITES.map(s => s.siteQuery).join(' OR ');
  const searchQuery = encodeURIComponent(`"${domain}" (${sitesQuery})`);
  const serpUrl = `https://serpapi.com/search.json?engine=google&q=${searchQuery}&api_key=${apiKey}&num=15&hl=it&gl=it`;

  const sources: ReviewSource[] = [];

  try {
    const response = await fetch(serpUrl);

    if (!response.ok) {
      throw new Error(`SerpApi error: ${response.status}`);
    }

    const data: SerpApiResult = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    const foundSites = new Set<string>();

    // Process organic results
    if (data.organic_results && data.organic_results.length > 0) {
      for (const result of data.organic_results) {
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

  const apiKey = process.env['SERP_API_KEY'];

  if (!apiKey) {
    console.error('SERP_API_KEY not configured');
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
