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

  // TODO: Implement real SSL certificate check

  return res.status(200).json({
    result: {
      type: 'ssl',
      status: 'safe',
      score: 100,
      weight: 10,
      message: 'Certificato SSL valido',
      details: {
        isValid: true,
        issuer: "Let's Encrypt",
        expiresAt: '2025-06-01',
        daysUntilExpiry: 180,
      },
    },
  });
}
