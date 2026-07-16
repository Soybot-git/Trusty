import { getCached, setCache, getCacheKey, CACHE_TTL } from '../lib/cache';
import type { Env } from '../lib/types';

interface SafeBrowsingResult {
  type: string;
  status: string;
  score: number;
  weight: number;
  message: string;
  details: {
    isMalware: boolean;
    isPhishing: boolean;
    threats: string[];
    error?: string;
  };
}

interface ThreatMatch {
  threatType: string;
  platformType: string;
  threat: { url: string };
  cacheDuration: string;
}

interface SafeBrowsingResponse {
  matches?: ThreatMatch[];
}

function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  return normalized;
}

function extractDomain(url: string): string {
  try {
    const normalized = normalizeUrl(url);
    const urlObj = new URL(normalized);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }
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

  const apiKey = env.GOOGLE_SAFE_BROWSING_KEY;

  if (!apiKey) {
    console.error('GOOGLE_SAFE_BROWSING_KEY not configured');
    return new Response(JSON.stringify({
      result: {
        type: 'safe-browsing',
        status: 'warning',
        score: 50,
        weight: 0,
        message: 'Verifica Safe Browsing non disponibile',
        details: {
          isMalware: false,
          isPhishing: false,
          threats: [],
          error: 'API not configured',
        },
      },
    }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  const normalizedUrl = normalizeUrl(url);
  const domain = extractDomain(url);
  const kv = env.TRUSTY_KV;
  const cacheKey = getCacheKey('safe-browsing', domain);

  const cached = await getCached<SafeBrowsingResult>(kv, cacheKey);
  if (cached) {
    return new Response(JSON.stringify({ result: cached }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  try {
    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client: {
            clientId: 'trusty-web',
            clientVersion: '1.0.0',
          },
          threatInfo: {
            threatTypes: [
              'MALWARE',
              'SOCIAL_ENGINEERING',
              'UNWANTED_SOFTWARE',
              'POTENTIALLY_HARMFUL_APPLICATION',
            ],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: normalizedUrl }],
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Google API error: ${response.status}`);
    }

    const data: SafeBrowsingResponse = await response.json();

    const threats = data.matches || [];
    const isMalware = threats.some((t) => t.threatType === 'MALWARE');
    const isPhishing = threats.some((t) => t.threatType === 'SOCIAL_ENGINEERING');
    const isUnwanted = threats.some((t) => t.threatType === 'UNWANTED_SOFTWARE');

    if (threats.length > 0) {
      const threatTypes = threats.map((t) => t.threatType);
      let message = 'Minacce rilevate: ';
      const messages: string[] = [];

      if (isPhishing) messages.push('phishing');
      if (isMalware) messages.push('malware');
      if (isUnwanted) messages.push('software indesiderato');

      message += messages.join(', ');

      const result: SafeBrowsingResult = {
        type: 'safe-browsing',
        status: 'danger',
        score: 0,
        weight: 0,
        message,
        details: {
          isMalware,
          isPhishing,
          threats: threatTypes,
        },
      };

      await setCache(kv, cacheKey, result, 60 * 60);

      return new Response(JSON.stringify({ result }), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    const result: SafeBrowsingResult = {
      type: 'safe-browsing',
      status: 'safe',
      score: 100,
      weight: 0,
      message: 'Nessuna minaccia rilevata da Google',
      details: {
        isMalware: false,
        isPhishing: false,
        threats: [],
      },
    };

    await setCache(kv, cacheKey, result, CACHE_TTL.SAFE_BROWSING);

    return new Response(JSON.stringify({ result }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Safe Browsing API error:', error);

    return new Response(JSON.stringify({
      result: {
        type: 'safe-browsing',
        status: 'warning',
        score: 50,
        weight: 0,
        message: 'Impossibile verificare con Google Safe Browsing',
        details: {
          isMalware: false,
          isPhishing: false,
          threats: [],
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
