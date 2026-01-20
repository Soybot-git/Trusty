import type { VercelRequest, VercelResponse } from '@vercel/node';

function extractDomain(url: string): string {
  try {
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    const urlObj = new URL(normalizedUrl);
    return urlObj.hostname;
  } catch {
    return url;
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

  const domain = extractDomain(url);
  const tld = domain.split('.').pop() || '';

  // TODO: Implement website scraping for heuristics

  return res.status(200).json({
    result: {
      type: 'heuristics',
      status: 'warning',
      score: 60,
      weight: 10,
      message: 'Verificare dati aziendali',
      details: {
        hasVatNumber: false,
        domainTld: tld,
        hasPrivacyPolicy: true,
        hasTerms: true,
        hasReturnPolicy: false,
        paymentMethods: ['PayPal', 'Carta di credito'],
        suspiciousPayments: false,
      },
    },
  });
}
