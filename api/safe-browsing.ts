import type { VercelRequest, VercelResponse } from '@vercel/node';

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
        weight: 25,
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

      return res.status(200).json({
        result: {
          type: 'safe-browsing',
          status: 'danger',
          score: 0,
          weight: 25,
          message,
          details: {
            isMalware,
            isPhishing,
            threats: threatTypes,
          },
        },
      });
    }

    // No threats found - site is safe
    return res.status(200).json({
      result: {
        type: 'safe-browsing',
        status: 'safe',
        score: 100,
        weight: 25,
        message: 'Nessuna minaccia rilevata da Google',
        details: {
          isMalware: false,
          isPhishing: false,
          threats: [],
        },
      },
    });
  } catch (error) {
    console.error('Safe Browsing API error:', error);

    return res.status(200).json({
      result: {
        type: 'safe-browsing',
        status: 'warning',
        score: 50,
        weight: 25,
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
