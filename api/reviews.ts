import type { VercelRequest, VercelResponse } from '@vercel/node';

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

function getScoreFromRating(rating: number, totalReviews: number): { score: number; status: string; message: string } {
  // Not enough reviews to be reliable
  if (totalReviews < 5) {
    return {
      score: 50,
      status: 'warning',
      message: 'Poche recensioni disponibili',
    };
  }

  if (rating >= 4.5) {
    return {
      score: 100,
      status: 'safe',
      message: `Eccellente: ${rating}/5 (${formatReviewCount(totalReviews)} recensioni)`,
    };
  }

  if (rating >= 4.0) {
    return {
      score: 90,
      status: 'safe',
      message: `Molto buono: ${rating}/5 (${formatReviewCount(totalReviews)} recensioni)`,
    };
  }

  if (rating >= 3.5) {
    return {
      score: 75,
      status: 'safe',
      message: `Buono: ${rating}/5 (${formatReviewCount(totalReviews)} recensioni)`,
    };
  }

  if (rating >= 3.0) {
    return {
      score: 60,
      status: 'warning',
      message: `Nella media: ${rating}/5 (${formatReviewCount(totalReviews)} recensioni)`,
    };
  }

  if (rating >= 2.0) {
    return {
      score: 35,
      status: 'warning',
      message: `Valutazione bassa: ${rating}/5 (${formatReviewCount(totalReviews)} recensioni)`,
    };
  }

  return {
    score: 15,
    status: 'danger',
    message: `Valutazione pessima: ${rating}/5 (${formatReviewCount(totalReviews)} recensioni)`,
  };
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

function parseReviewCount(text: string): number {
  // Parse strings like "1,234 reviews", "12.5k reviews", "1234"
  const cleaned = text.toLowerCase().replace(/[,\.]/g, '').replace('reviews', '').trim();

  if (cleaned.includes('k')) {
    return Math.round(parseFloat(cleaned.replace('k', '')) * 1000);
  }

  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Calculate dynamic weight based on number of reviews
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
        weight: 10, // Minimum weight when reviews unavailable
        message: 'Verifica recensioni non disponibile',
        details: {
          rating: null,
          totalReviews: 0,
          source: 'Trustpilot',
          url: `https://www.trustpilot.com/review/${domain}`,
          error: 'API not configured',
        },
      },
    });
  }

  try {
    // Search for Trustpilot reviews of this domain
    const searchQuery = encodeURIComponent(`site:trustpilot.com "${domain}"`);
    const serpUrl = `https://serpapi.com/search.json?engine=google&q=${searchQuery}&api_key=${apiKey}&num=5&hl=it&gl=it`;

    const response = await fetch(serpUrl);

    if (!response.ok) {
      throw new Error(`SerpApi error: ${response.status}`);
    }

    const data: SerpApiResult = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Find the Trustpilot result for this domain
    let rating: number | null = null;
    let totalReviews: number = 0;
    let trustpilotUrl = `https://www.trustpilot.com/review/${domain}`;

    if (data.organic_results && data.organic_results.length > 0) {
      for (const result of data.organic_results) {
        // Check if this is the Trustpilot page for our domain
        if (result.link?.includes('trustpilot.com/review/')) {
          trustpilotUrl = result.link;

          // Try to get rating from rich snippet
          if (result.rich_snippet?.top?.detected_extensions) {
            const ext = result.rich_snippet.top.detected_extensions;
            if (ext.rating) {
              rating = ext.rating;
            }
            if (ext.reviews) {
              totalReviews = ext.reviews;
            }
          }

          // Try to parse from extensions array if not found
          if (rating === null && result.rich_snippet?.top?.extensions) {
            for (const ext of result.rich_snippet.top.extensions) {
              // Look for patterns like "4.5" or "Rating: 4.5"
              const ratingMatch = ext.match(/(\d+\.?\d*)\s*(\/\s*5|stars?|stelle)?/i);
              if (ratingMatch && !ext.toLowerCase().includes('review')) {
                const parsed = parseFloat(ratingMatch[1]);
                if (parsed >= 1 && parsed <= 5) {
                  rating = parsed;
                }
              }
              // Look for review count
              const reviewMatch = ext.match(/(\d+[\d,\.]*k?)\s*review/i);
              if (reviewMatch) {
                totalReviews = parseReviewCount(reviewMatch[1]);
              }
            }
          }

          // Try to extract from snippet text
          if (rating === null && result.snippet) {
            const snippetRating = result.snippet.match(/(\d+\.?\d*)\s*\/\s*5/);
            if (snippetRating) {
              rating = parseFloat(snippetRating[1]);
            }
          }

          break; // Found the main Trustpilot result
        }
      }
    }

    // If no rating found, return warning
    if (rating === null) {
      return res.status(200).json({
        result: {
          type: 'reviews',
          status: 'warning',
          score: 50,
          weight: 10, // Minimum weight when no reviews found
          message: 'Nessuna recensione trovata su Trustpilot',
          details: {
            rating: null,
            totalReviews: 0,
            source: 'Trustpilot',
            url: trustpilotUrl,
          },
        },
      });
    }

    const { score, status, message } = getScoreFromRating(rating, totalReviews);
    const weight = getReviewsWeight(totalReviews);

    return res.status(200).json({
      result: {
        type: 'reviews',
        status,
        score,
        weight,
        message,
        details: {
          rating,
          totalReviews,
          source: 'Trustpilot',
          url: trustpilotUrl,
        },
      },
    });
  } catch (error) {
    console.error('SerpApi error:', error);

    return res.status(200).json({
      result: {
        type: 'reviews',
        status: 'warning',
        score: 50,
        weight: 10, // Minimum weight on error
        message: 'Impossibile verificare recensioni',
        details: {
          rating: null,
          totalReviews: 0,
          source: 'Trustpilot',
          url: `https://www.trustpilot.com/review/${domain}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
    });
  }
}
