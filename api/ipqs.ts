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

  // TODO: Integrate with IPQualityScore API
  // const apiKey = process.env.IPQS_API_KEY;

  return res.status(200).json({
    result: {
      type: 'ipqs',
      status: 'safe',
      score: 85,
      weight: 15,
      message: 'Nessun rischio significativo',
      details: {
        fraudScore: 15,
        isProxy: false,
        isVpn: false,
        isTor: false,
        recentAbuse: false,
      },
    },
  });
}
