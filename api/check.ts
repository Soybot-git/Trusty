import type { VercelRequest, VercelResponse } from '@vercel/node';

// Types
interface CheckResult {
  type: string;
  status: 'safe' | 'warning' | 'danger' | 'unknown';
  score: number;
  weight: number;
  message: string;
  details: Record<string, unknown>;
}

// Extract domain from URL
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

// Individual check functions
async function checkSafeBrowsing(domain: string): Promise<CheckResult> {
  // TODO: Integrate with Google Safe Browsing API
  // const apiKey = process.env.GOOGLE_SAFE_BROWSING_KEY;
  return {
    type: 'safe-browsing',
    status: 'safe',
    score: 100,
    weight: 25,
    message: 'Nessuna minaccia rilevata',
    details: {
      isMalware: false,
      isPhishing: false,
      threats: [],
    },
  };
}

async function checkWhois(domain: string): Promise<CheckResult> {
  // TODO: Integrate with WhoisXML API
  // const apiKey = process.env.WHOIS_API_KEY;
  return {
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
  };
}

async function checkSsl(domain: string): Promise<CheckResult> {
  // TODO: Implement real SSL check
  return {
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
  };
}

async function checkIpqs(domain: string): Promise<CheckResult> {
  // TODO: Integrate with IPQualityScore API
  // const apiKey = process.env.IPQS_API_KEY;
  return {
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
  };
}

async function checkReviews(domain: string): Promise<CheckResult> {
  // TODO: Integrate with SerpApi for Trustpilot data
  // const apiKey = process.env.SERP_API_KEY;
  return {
    type: 'reviews',
    status: 'warning',
    score: 50,
    weight: 20,
    message: 'Poche recensioni disponibili',
    details: {
      rating: 0,
      totalReviews: 0,
      source: 'Trustpilot',
      url: `https://www.trustpilot.com/review/${domain}`,
    },
  };
}

async function checkHeuristics(domain: string): Promise<CheckResult> {
  // TODO: Implement website scraping for heuristics
  const tld = domain.split('.').pop() || '';
  return {
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
  };
}

// Generate bullets from results
function generateBullets(results: CheckResult[]) {
  const sortedResults = [...results].sort((a, b) => {
    const statusOrder = { danger: 0, warning: 1, unknown: 2, safe: 3 };
    return statusOrder[a.status] - statusOrder[b.status];
  });

  return sortedResults.slice(0, 4).map((result) => ({
    icon: result.status === 'safe' ? 'check' : result.status === 'danger' ? 'danger' : 'warning',
    text: result.message,
  }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const domain = extractDomain(url);

  try {
    // Run all checks in parallel
    const results = await Promise.all([
      checkSafeBrowsing(domain),
      checkWhois(domain),
      checkSsl(domain),
      checkIpqs(domain),
      checkReviews(domain),
      checkHeuristics(domain),
    ]);

    // Calculate total score
    let totalWeight = 0;
    let weightedScore = 0;

    for (const result of results) {
      weightedScore += result.score * (result.weight / 100);
      totalWeight += result.weight;
    }

    const finalScore = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 50;

    // Determine trust level
    let level: 'safe' | 'caution' | 'danger';
    if (finalScore >= 70) level = 'safe';
    else if (finalScore >= 40) level = 'caution';
    else level = 'danger';

    return res.status(200).json({
      url,
      domain,
      score: finalScore,
      level,
      bullets: generateBullets(results),
      details: results,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Check failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
