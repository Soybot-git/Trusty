import { getCached, setCache, getCacheKey, CACHE_TTL } from '../lib/cache';
import type { Env } from '../lib/types';

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

interface SourceResult {
  name: string;
  rating: number | null;
  totalReviews: number;
  url: string | null;
}

interface ReviewScore {
  score: number;
  status: string;
  message: string;
  insufficientReviews: boolean;
}

const MIN_REVIEWS_THRESHOLD = 20;
const REVIEWS_WEIGHT = 30;
const FETCH_TIMEOUT_MS = 8000;

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

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    signal: controller.signal,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  }).finally(() => clearTimeout(timeoutId));
}

function extractJsonLdRating(html: string): { rating: number; totalReviews: number } | null {
  const jsonLdBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (!jsonLdBlocks) return null;

  for (const block of jsonLdBlocks) {
    const jsonContent = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
    try {
      const parsed = JSON.parse(jsonContent);
      const items: any[] = [];
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      for (const root of roots) {
        items.push(root);
        if (root['@graph']) {
          const graphItems = Array.isArray(root['@graph']) ? root['@graph'] : [root['@graph']];
          items.push(...graphItems);
        }
      }
      for (const item of items) {
        if (item.aggregateRating?.ratingValue) {
          return {
            rating: parseFloat(String(item.aggregateRating.ratingValue).replace(',', '.')),
            totalReviews: parseInt(String(item.aggregateRating.reviewCount || '0'), 10) || 0,
          };
        }
      }
    } catch {
      // continue to next block
    }
  }
  return null;
}

function extractMicrodataRating(html: string): { rating: number; totalReviews: number } | null {
  const ratingMatch = html.match(/itemprop=["']ratingValue["'][^>]*(?:content=["'](\d+(?:\.\d+)?)["']|>(\d+(?:\.\d+)?)<)/i);
  const countMatch = html.match(/itemprop=["']reviewCount["'][^>]*(?:content=["'](\d+)["']|>(\d+)<)/i);

  if (!ratingMatch) return null;

  const rating = parseFloat(ratingMatch[1] || ratingMatch[2]);
  const totalReviews = countMatch ? parseInt(countMatch[1] || countMatch[2], 10) : 0;

  if (isNaN(rating)) return null;
  return { rating, totalReviews };
}

function extractDataAttrRating(html: string): { rating: number; totalReviews: number } | null {
  const ratingMatch = html.match(/data-rating[_-]?(?:value|score)?[=:]["']?(\d+(?:\.\d+)?)/i);
  const countMatch = html.match(/data-reviews[_-]?(?:count|number)?[=:]["']?(\d+)/i);

  if (!ratingMatch) return null;

  const rating = parseFloat(ratingMatch[1]);
  const totalReviews = countMatch ? parseInt(countMatch[1], 10) : 0;

  if (isNaN(rating)) return null;
  return { rating, totalReviews };
}

function extractTrustpilotRating(html: string): { rating: number; totalReviews: number } | null {
  const jsonLdResult = extractJsonLdRating(html);
  if (jsonLdResult) return jsonLdResult;

  const microdataResult = extractMicrodataRating(html);
  if (microdataResult) return microdataResult;

  const dataAttrResult = extractDataAttrRating(html);
  if (dataAttrResult) return dataAttrResult;

  return null;
}

async function fetchTrustpilotData(domain: string): Promise<SourceResult> {
  const locales = ['www', 'it'];

  for (const locale of locales) {
    const trustpilotUrl = `https://${locale}.trustpilot.com/review/${domain}`;

    try {
      const response = await fetchWithTimeout(trustpilotUrl, FETCH_TIMEOUT_MS);

      if (response.status === 429 || response.status >= 500) {
        await new Promise(r => setTimeout(r, 1000));
        const retryResponse = await fetchWithTimeout(trustpilotUrl, FETCH_TIMEOUT_MS);
        if (!retryResponse.ok) continue;

        const html = await retryResponse.text();
        const result = extractTrustpilotRating(html);
        if (result) {
          return { name: 'Trustpilot', rating: result.rating, totalReviews: result.totalReviews, url: trustpilotUrl };
        }
        continue;
      }

      if (!response.ok) continue;

      const html = await response.text();
      const result = extractTrustpilotRating(html);
      if (result) {
        return { name: 'Trustpilot', rating: result.rating, totalReviews: result.totalReviews, url: trustpilotUrl };
      }
    } catch (error) {
      console.error(`Trustpilot (${locale}) error for ${domain}:`, error);
    }
  }

  return { name: 'Trustpilot', rating: null, totalReviews: 0, url: `https://www.trustpilot.com/review/${domain}` };
}

async function fetchTrustedShopsData(domain: string): Promise<SourceResult> {
  const url = `https://www.trustedshops.com/shop/rating.php?domain=${domain}`;

  try {
    const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);

    if (!response.ok) {
      return { name: 'TrustedShops', rating: null, totalReviews: 0, url };
    }

    const text = await response.text();
    const jsonMatch = text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      return { name: 'TrustedShops', rating: null, totalReviews: 0, url };
    }

    const data = JSON.parse(jsonMatch[1]);
    const rating = data.tsRating ? parseFloat(String(data.tsRating).replace(',', '.')) : null;
    const totalReviews = data.tsRatingCount ? parseInt(String(data.tsRatingCount), 10) : 0;

    if (rating === null || totalReviews === 0) {
      return { name: 'TrustedShops', rating: null, totalReviews: 0, url };
    }

    return { name: 'TrustedShops', rating, totalReviews, url };
  } catch (error) {
    console.error('TrustedShops fetch error:', error);
    return { name: 'TrustedShops', rating: null, totalReviews: 0, url };
  }
}

function extractSitejabberRating(html: string): { rating: number; totalReviews: number } | null {
  const jsonLdResult = extractJsonLdRating(html);
  if (jsonLdResult) return jsonLdResult;

  const microdataResult = extractMicrodataRating(html);
  if (microdataResult) return microdataResult;

  const dataAttrResult = extractDataAttrRating(html);
  if (dataAttrResult) return dataAttrResult;

  return null;
}

async function fetchSitejabberData(domain: string): Promise<SourceResult> {
  const url = `https://www.sitejabber.com/reviews/${domain}`;

  try {
    const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);

    if (!response.ok) {
      return { name: 'Sitejabber', rating: null, totalReviews: 0, url };
    }

    const html = await response.text();
    const result = extractSitejabberRating(html);

    if (!result) {
      return { name: 'Sitejabber', rating: null, totalReviews: 0, url };
    }

    return { name: 'Sitejabber', rating: result.rating, totalReviews: result.totalReviews, url };
  } catch (error) {
    console.error('Sitejabber fetch error:', error);
    return { name: 'Sitejabber', rating: null, totalReviews: 0, url };
  }
}

function aggregateSources(sources: SourceResult[]): {
  aggregatedRating: number | null;
  totalReviews: number;
  sourceCount: number;
  insufficientReviews: boolean;
  discrepancy: boolean;
} {
  const validSources = sources.filter(s => s.rating !== null);

  if (validSources.length === 0) {
    return { aggregatedRating: null, totalReviews: 0, sourceCount: 0, insufficientReviews: true, discrepancy: false };
  }

  let totalWeight = 0;
  let weightedSum = 0;
  let totalReviewsSum = 0;

  for (const s of validSources) {
    const weight = s.totalReviews > 0 ? s.totalReviews : 1;
    weightedSum += s.rating * weight;
    totalWeight += weight;
    totalReviewsSum += s.totalReviews;
  }

  const aggregatedRating = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : null;
  const sourceCount = validSources.length;

  const maxRating = Math.max(...validSources.map(s => s.rating));
  const minRating = Math.min(...validSources.map(s => s.rating));
  const discrepancy = validSources.length >= 2 && (maxRating - minRating) > 1.5;

  return {
    aggregatedRating,
    totalReviews: totalReviewsSum,
    sourceCount,
    insufficientReviews: totalReviewsSum < MIN_REVIEWS_THRESHOLD,
    discrepancy,
  };
}

function getScoreFromReviewData(
  rating: number | null,
  totalReviews: number,
  discrepancy: boolean,
  sourceCount: number
): ReviewScore {
  if (rating === null || totalReviews < MIN_REVIEWS_THRESHOLD) {
    return {
      score: 0,
      status: 'warning',
      message: 'Non ci sono abbastanza recensioni',
      insufficientReviews: true,
    };
  }

  const sourceInfo = sourceCount > 1 ? `, ${sourceCount} fonti` : '';
  const reviewInfo = ` (${formatReviewCount(totalReviews)} recensioni${sourceInfo})`;

  let score: number;
  let status: string;
  let baseMessage: string;

  if (rating >= 4.5) {
    score = 100;
    status = 'safe';
    baseMessage = 'Eccellente';
  } else if (rating >= 4.0) {
    score = 90;
    status = 'safe';
    baseMessage = 'Molto buono';
  } else if (rating >= 3.5) {
    score = 75;
    status = 'safe';
    baseMessage = 'Buono';
  } else if (rating >= 3.0) {
    score = 60;
    status = 'warning';
    baseMessage = 'Nella media';
  } else if (rating >= 2.0) {
    score = 35;
    status = 'warning';
    baseMessage = 'Valutazione bassa';
  } else {
    score = 15;
    status = 'danger';
    baseMessage = 'Valutazione pessima';
  }

  if (discrepancy) {
    score = Math.max(0, score - 20);
    if (status === 'safe' && score < 70) status = 'warning';
    return {
      score,
      status,
      message: `Recensioni discordanti tra le fonti (media ${rating}/5)${reviewInfo}`,
      insufficientReviews: false,
    };
  }

  return {
    score,
    status,
    message: `${baseMessage}: ${rating}/5${reviewInfo}`,
    insufficientReviews: false,
  };
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  const { url } = await request.json() as { url?: string };

  if (!url) {
    return new Response(JSON.stringify({ error: 'URL is required' }), {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  const domain = extractDomain(url);
  const kv = env.TRUSTY_KV;
  const cacheKey = getCacheKey('reviews', domain);

  const cached = await getCached<ReviewsResult>(kv, cacheKey);
  if (cached) {
    return new Response(JSON.stringify({ result: cached }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  try {
    const results = await Promise.allSettled([
      fetchTrustpilotData(domain),
      fetchTrustedShopsData(domain),
      fetchSitejabberData(domain),
    ]);

    const sources: SourceResult[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        sources.push(result.value);
      }
    }

    const { aggregatedRating, totalReviews, sourceCount, insufficientReviews, discrepancy } = aggregateSources(sources);

    const { score, status, message } = getScoreFromReviewData(
      aggregatedRating,
      totalReviews,
      discrepancy,
      sourceCount
    );

    const result: ReviewsResult = {
      type: 'reviews',
      status,
      score,
      weight: REVIEWS_WEIGHT,
      message,
      details: {
        aggregatedRating,
        totalReviews,
        sourceCount,
        sources: sources.map(s => ({
          name: s.name,
          rating: s.rating,
          totalReviews: s.totalReviews,
          url: s.url,
        })),
        insufficientReviews,
      },
    };

    await setCache(kv, cacheKey, result, CACHE_TTL.REVIEWS);

    return new Response(JSON.stringify({ result }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Reviews error:', error);

    return new Response(JSON.stringify({
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
    }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }
};
