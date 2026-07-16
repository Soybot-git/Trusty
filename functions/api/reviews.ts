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

const MIN_REVIEWS_THRESHOLD = 20;
const REVIEWS_WEIGHT = 30;

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
            console.log(`Found rating in @type=${item['@type']}: ${item.aggregateRating.ratingValue}, reviewCount: ${item.aggregateRating.reviewCount}`);
            return {
              rating: parseFloat(String(item.aggregateRating.ratingValue).replace(',', '.')),
              totalReviews: parseInt(String(item.aggregateRating.reviewCount || '0'), 10) || 0,
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

interface ReviewScore {
  score: number;
  status: string;
  message: string;
  insufficientReviews: boolean;
}

function getScoreFromReviewData(rating: number | null, totalReviews: number): ReviewScore {
  if (rating === null || totalReviews < MIN_REVIEWS_THRESHOLD) {
    return {
      score: 0,
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
