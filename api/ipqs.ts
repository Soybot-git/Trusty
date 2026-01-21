import type { VercelRequest, VercelResponse } from '@vercel/node';

interface IPQSResponse {
  success: boolean;
  message?: string;
  unsafe: boolean;
  risk_score: number;
  suspicious: boolean;
  phishing: boolean;
  malware: boolean;
  parking: boolean;
  spamming: boolean;
  adult: boolean;
  category?: string;
  domain_age?: {
    human: string;
    timestamp: number;
    iso: string;
  };
  server?: string;
  content_type?: string;
}

function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  return normalized;
}

function getScoreFromRiskScore(riskScore: number, data: IPQSResponse): { score: number; status: string; message: string } {
  // IPQS risk_score: 0 = safe, 100 = dangerous (inverted from our scale)

  if (data.malware) {
    return { score: 0, status: 'danger', message: 'Malware rilevato sul sito' };
  }

  if (data.phishing) {
    return { score: 0, status: 'danger', message: 'Sito di phishing rilevato' };
  }

  if (data.parking) {
    return { score: 20, status: 'danger', message: 'Dominio parcheggiato (non attivo)' };
  }

  if (riskScore >= 85) {
    return { score: 10, status: 'danger', message: 'Rischio molto alto rilevato' };
  }

  if (riskScore >= 75) {
    return { score: 30, status: 'danger', message: 'Rischio alto rilevato' };
  }

  if (data.suspicious || riskScore >= 50) {
    return { score: 50, status: 'warning', message: 'Alcuni elementi sospetti rilevati' };
  }

  if (riskScore >= 25) {
    return { score: 70, status: 'warning', message: 'Rischio basso rilevato' };
  }

  return { score: 100, status: 'safe', message: 'Nessun rischio significativo' };
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

  const apiKey = process.env['IPQS_API_KEY'];

  if (!apiKey) {
    console.error('IPQS_API_KEY not configured');
    return res.status(200).json({
      result: {
        type: 'ipqs',
        status: 'warning',
        score: 50,
        weight: 15,
        message: 'Verifica reputazione non disponibile',
        details: {
          error: 'API not configured',
        },
      },
    });
  }

  const normalizedUrl = normalizeUrl(url);
  const encodedUrl = encodeURIComponent(normalizedUrl);

  try {
    const response = await fetch(
      `https://www.ipqualityscore.com/api/json/url/${apiKey}/${encodedUrl}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`IPQS API error: ${response.status}`);
    }

    const data: IPQSResponse = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'IPQS request failed');
    }

    const { score, status, message } = getScoreFromRiskScore(data.risk_score, data);

    return res.status(200).json({
      result: {
        type: 'ipqs',
        status,
        score,
        weight: 15,
        message,
        details: {
          riskScore: data.risk_score,
          unsafe: data.unsafe,
          suspicious: data.suspicious,
          phishing: data.phishing,
          malware: data.malware,
          parking: data.parking,
          spamming: data.spamming,
          category: data.category || null,
        },
      },
    });
  } catch (error) {
    console.error('IPQS error:', error);

    return res.status(200).json({
      result: {
        type: 'ipqs',
        status: 'warning',
        score: 50,
        weight: 15,
        message: 'Impossibile verificare reputazione',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
    });
  }
}
