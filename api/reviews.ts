import type { VercelRequest, VercelResponse } from '@vercel/node';

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
  knowledge_graph?: {
    rating?: number;
    review_count?: number;
    reviews_link?: string;
  };
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
  {
    name: 'eKomi',
    urlPattern: /ekomi\.it/,
    siteQuery: 'site:ekomi.it',
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

/**
 * Calculate dynamic weight based on total reviews across all sources
 * - < 50 reviews: 10% (few reviews might be fake)
 * - 50-200 reviews: 20% (moderate confidence)
 * - > 200 reviews: 30% (high confidence in real feedback)
 */
function getReviewsWeight(totalReviews: number): number {
  if (totalReviews < 50) {
    return 10;
  }
  if (totalReviews <= 200) {
    return 20;
  }
  return 30;
}

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

// ==================== SEARCH FUNCTIONS ====================

/**
 * Search for Google Knowledge Graph reviews (separate query without site: filter)
 */
async function searchGoogleKnowledgeGraph(domain: string, apiKey: string): Promise<ReviewSource | null> {
  const searchQuery = encodeURIComponent(`${domain}`);
  const serpUrl = `https://serpapi.com/search.json?engine=google&q=${searchQuery}&api_key=${apiKey}&num=1&hl=it&gl=it`;

  try {
    const response = await fetch(serpUrl);

    if (!response.ok) {
      return null;
    }

    const data: SerpApiResult = await response.json();

    if (data.error || !data.knowledge_graph) {
      return null;
    }

    const kg = data.knowledge_graph;
    if (kg.rating || kg.review_count) {
      return {
        name: 'Google',
        rating: kg.rating || null,
        totalReviews: kg.review_count || 0,
        url: kg.reviews_link || null,
      };
    }
  } catch (error) {
    console.error('Error searching Google Knowledge Graph:', error);
  }

  return null;
}

/**
 * Search all review sites with combined OR query
 */
async function searchReviewSites(domain: string, apiKey: string): Promise<ReviewSource[]> {
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

/**
 * Search all review sources (review sites + Google Knowledge Graph)
 * Uses 2 API calls: one for review sites, one for Google KG
 */
async function searchAllReviewSources(domain: string, apiKey: string): Promise<ReviewSource[]> {
  // Run both searches in parallel
  const [reviewSites, googleKG] = await Promise.all([
    searchReviewSites(domain, apiKey),
    searchGoogleKnowledgeGraph(domain, apiKey),
  ]);

  const sources: ReviewSource[] = [...reviewSites];

  // Add Google KG if found
  if (googleKG) {
    sources.push(googleKG);
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

function getScoreFromAggregatedReviews(aggregated: AggregatedReviews): { score: number; status: string; message: string } {
  const { aggregatedRating, totalReviews, sourceCount } = aggregated;

  // No reviews found anywhere
  if (aggregatedRating === null) {
    return {
      score: 50,
      status: 'warning',
      message: 'Nessuna recensione trovata online',
    };
  }

  // Very few reviews (might be fake)
  if (totalReviews > 0 && totalReviews < 5) {
    return {
      score: 50,
      status: 'warning',
      message: `Poche recensioni (${totalReviews}) - ${aggregatedRating}/5`,
    };
  }

  // Build message with source info
  const sourceInfo = sourceCount > 1 ? ` da ${sourceCount} fonti` : '';
  const reviewInfo = totalReviews > 0 ? ` (${formatReviewCount(totalReviews)} recensioni${sourceInfo})` : sourceInfo;

  if (aggregatedRating >= 4.5) {
    return {
      score: 100,
      status: 'safe',
      message: `Eccellente: ${aggregatedRating}/5${reviewInfo}`,
    };
  }

  if (aggregatedRating >= 4.0) {
    return {
      score: 90,
      status: 'safe',
      message: `Molto buono: ${aggregatedRating}/5${reviewInfo}`,
    };
  }

  if (aggregatedRating >= 3.5) {
    return {
      score: 75,
      status: 'safe',
      message: `Buono: ${aggregatedRating}/5${reviewInfo}`,
    };
  }

  if (aggregatedRating >= 3.0) {
    return {
      score: 60,
      status: 'warning',
      message: `Nella media: ${aggregatedRating}/5${reviewInfo}`,
    };
  }

  if (aggregatedRating >= 2.0) {
    return {
      score: 35,
      status: 'warning',
      message: `Valutazione bassa: ${aggregatedRating}/5${reviewInfo}`,
    };
  }

  return {
    score: 15,
    status: 'danger',
    message: `Valutazione pessima: ${aggregatedRating}/5${reviewInfo}`,
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
  const apiKey = process.env['SERP_API_KEY'];

  if (!apiKey) {
    console.error('SERP_API_KEY not configured');
    return res.status(200).json({
      result: {
        type: 'reviews',
        status: 'warning',
        score: 50,
        weight: 10,
        message: 'Verifica recensioni non disponibile',
        details: {
          aggregatedRating: null,
          totalReviews: 0,
          sourceCount: 0,
          sources: [],
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
    const { score, status, message } = getScoreFromAggregatedReviews(aggregated);
    const weight = getReviewsWeight(aggregated.totalReviews);

    // Filter sources for response (only include those with data)
    const sourcesWithData = sources.filter((s) => s.rating !== null || s.url !== null);

    return res.status(200).json({
      result: {
        type: 'reviews',
        status,
        score,
        weight,
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
        },
      },
    });
  } catch (error) {
    console.error('Reviews aggregation error:', error);

    return res.status(200).json({
      result: {
        type: 'reviews',
        status: 'warning',
        score: 50,
        weight: 10,
        message: 'Impossibile verificare recensioni',
        details: {
          aggregatedRating: null,
          totalReviews: 0,
          sourceCount: 0,
          sources: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
    });
  }
}
