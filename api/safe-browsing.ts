import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCached, setCache, getCacheKey, CACHE_TTL } from './lib/cache.js';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
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

  const apiKey = process.env['GOOGLE_SAFE_BROWSING_KEY'];

  if (!apiKey) {
    console.error('GOOGLE_SAFE_BROWSING_KEY not configured');
    return res.status(200).json({
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
    });
  }

  const normalizedUrl = normalizeUrl(url);
  const domain = extractDomain(url);
  const cacheKey = getCacheKey('safe-browsing', domain);

  // Check cache first
  const cached = await getCached<SafeBrowsingResult>(cacheKey);
  if (cached) {
    return res.status(200).json({ result: cached });
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

    // If matches array exists and has items, threats were found
    const threats = data.matches || [];
    const isMalware = threats.some((t) => t.threatType === 'MALWARE');
    const isPhishing = threats.some((t) => t.threatType === 'SOCIAL_ENGINEERING');
    const isUnwanted = threats.some((t) => t.threatType === 'UNWANTED_SOFTWARE');

    if (threats.length > 0) {
      // Dangerous site detected
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

      // Cache dangerous results with shorter TTL (1 hour) to allow re-check
      await setCache(cacheKey, result, 60 * 60);

      return res.status(200).json({ result });
    }

    // No threats found - site is safe
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

    // Cache safe results
    await setCache(cacheKey, result, CACHE_TTL.SAFE_BROWSING);

    return res.status(200).json({ result });
  } catch (error) {
    console.error('Safe Browsing API error:', error);

    return res.status(200).json({
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
    });
  }
}
