import type { VercelRequest, VercelResponse } from '@vercel/node';

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

  // TODO: Integrate with WhoisXML API
  // const apiKey = process.env.WHOIS_API_KEY;

  return res.status(200).json({
    result: {
      type: 'whois',
      status: 'safe',
      score: 80,
      weight: 20,
      message: 'Dominio attivo da 2 anni',
      details: {
        domainAge: 730,
        registrar: 'Unknown',
        creationDate: '2023-01-01',
        expirationDate: '2025-01-01',
        country: 'IT',
      },
    },
  });
}
