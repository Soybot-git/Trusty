import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCached, setCache, getCacheKey, CACHE_TTL } from './lib/cache.js';

interface HeuristicsResult {
  type: string;
  status: string;
  score: number;
  weight: number;
  message: string;
  details: Record<string, unknown>;
}

// ==================== CONFIGURATION ====================

// Known legitimate brands for lookalike detection
const KNOWN_BRANDS = [
  'amazon', 'ebay', 'zalando', 'alibaba', 'aliexpress',
  'apple', 'microsoft', 'google', 'facebook', 'instagram',
  'paypal', 'netflix', 'spotify', 'nike', 'adidas',
  'samsung', 'sony', 'ikea', 'mediaworld', 'unieuro',
  'esselunga', 'conad', 'lidl', 'euronics', 'trony',
  'decathlon', 'leroy', 'merlin', 'brico', 'obi',
  'booking', 'airbnb', 'ryanair', 'easyjet', 'trenitalia',
  'poste', 'intesa', 'unicredit', 'bnl', 'fineco',
  'vodafone', 'tim', 'wind', 'tre', 'iliad', 'fastweb',
  'subito', 'autoscout', 'immobiliare', 'idealista',
];

// Character substitutions commonly used in typosquatting
const CHAR_SUBSTITUTIONS: Record<string, string[]> = {
  'a': ['4', '@', 'à'],
  'e': ['3', '€', 'è'],
  'i': ['1', '!', 'l', '|'],
  'o': ['0', 'ò'],
  'u': ['v', 'ù'],
  's': ['5', '$'],
  'l': ['1', 'i', '|'],
  'b': ['8', '6'],
  'g': ['9', '6'],
  't': ['7', '+'],
};

// TLDs commonly associated with spam/scam sites
const SUSPICIOUS_TLDS = [
  'xyz', 'top', 'click', 'work', 'link', 'gq', 'ml', 'cf', 'ga', 'tk',
  'buzz', 'surf', 'monster', 'quest', 'sbs', 'cfd', 'boats', 'cam',
  'icu', 'cyou', 'rest', 'beauty', 'hair', 'skin', 'makeup',
  'bar', 'loan', 'racing', 'review', 'cricket', 'win', 'bid',
  'stream', 'download', 'accountant', 'science', 'date', 'faith',
];

// Trusted TLDs (get bonus points)
const TRUSTED_TLDS = [
  'it', 'com', 'org', 'net', 'eu', 'gov', 'edu',
  'co.uk', 'de', 'fr', 'es', 'nl', 'be', 'at', 'ch',
];

// ==================== HELPER FUNCTIONS ====================

function extractDomain(url: string): string {
  try {
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    const urlObj = new URL(normalizedUrl);
    return urlObj.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].toLowerCase();
  }
}

function getTld(domain: string): string {
  const parts = domain.split('.');
  return parts[parts.length - 1].toLowerCase();
}

function getDomainWithoutTld(domain: string): string {
  const parts = domain.split('.');
  if (parts.length > 1) {
    parts.pop(); // Remove TLD
  }
  return parts.join('.');
}

// Calculate Levenshtein distance between two strings
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Normalize domain by replacing common substitutions
function normalizeDomain(domain: string): string {
  let normalized = domain.toLowerCase();

  for (const [original, substitutes] of Object.entries(CHAR_SUBSTITUTIONS)) {
    for (const sub of substitutes) {
      normalized = normalized.split(sub).join(original);
    }
  }

  // Remove hyphens and numbers for comparison
  normalized = normalized.replace(/[-_]/g, '').replace(/\d/g, '');

  return normalized;
}

// ==================== CHECK FUNCTIONS ====================

interface CheckResult {
  passed: boolean;
  penalty: number;
  message: string;
  severity: 'info' | 'warning' | 'danger';
}

function checkTyposquatting(domain: string): CheckResult {
  const domainBase = getDomainWithoutTld(domain);
  const normalized = normalizeDomain(domainBase);

  for (const brand of KNOWN_BRANDS) {
    // Check if domain contains character substitutions of a brand
    if (normalized === brand && domainBase !== brand) {
      return {
        passed: false,
        penalty: 50,
        message: `Possibile typosquatting: simile a "${brand}"`,
        severity: 'danger',
      };
    }

    // Check Levenshtein distance for close matches
    if (domainBase !== brand) {
      const distance = levenshteinDistance(domainBase, brand);
      if (distance === 1 && domainBase.length >= 4) {
        return {
          passed: false,
          penalty: 40,
          message: `Dominio molto simile a "${brand}"`,
          severity: 'danger',
        };
      }
      if (distance === 2 && domainBase.length >= 6) {
        return {
          passed: false,
          penalty: 25,
          message: `Dominio simile a "${brand}"`,
          severity: 'warning',
        };
      }
    }

    // Check if brand is contained with extra chars (e.g., "amazon-shop", "nike-official")
    if (domainBase.includes(brand) && domainBase !== brand) {
      const suffixes = ['-shop', '-store', '-official', '-italia', '-it', '-outlet', '-sale', '-online'];
      for (const suffix of suffixes) {
        if (domainBase === brand + suffix.replace('-', '') || domainBase.includes(brand + suffix.replace('-', ''))) {
          return {
            passed: false,
            penalty: 30,
            message: `Dominio sospetto: usa il brand "${brand}"`,
            severity: 'warning',
          };
        }
      }
    }
  }

  return { passed: true, penalty: 0, message: '', severity: 'info' };
}

function checkSuspiciousTld(tld: string): CheckResult {
  if (SUSPICIOUS_TLDS.includes(tld)) {
    return {
      passed: false,
      penalty: 25,
      message: `TLD sospetto (.${tld})`,
      severity: 'warning',
    };
  }

  if (TRUSTED_TLDS.includes(tld)) {
    return {
      passed: true,
      penalty: -5, // Bonus for trusted TLD
      message: `TLD affidabile (.${tld})`,
      severity: 'info',
    };
  }

  return { passed: true, penalty: 0, message: '', severity: 'info' };
}

function checkDomainLength(domain: string): CheckResult {
  const domainBase = getDomainWithoutTld(domain);

  if (domainBase.length > 30) {
    return {
      passed: false,
      penalty: 20,
      message: 'Nome dominio eccessivamente lungo',
      severity: 'warning',
    };
  }

  if (domainBase.length > 20) {
    return {
      passed: false,
      penalty: 10,
      message: 'Nome dominio molto lungo',
      severity: 'info',
    };
  }

  return { passed: true, penalty: 0, message: '', severity: 'info' };
}

function checkSuspiciousPatterns(domain: string): CheckResult {
  const domainBase = getDomainWithoutTld(domain);
  let totalPenalty = 0;
  const issues: string[] = [];

  // Count hyphens
  const hyphenCount = (domainBase.match(/-/g) || []).length;
  if (hyphenCount >= 3) {
    totalPenalty += 20;
    issues.push('troppi trattini');
  } else if (hyphenCount >= 2) {
    totalPenalty += 10;
    issues.push('molti trattini');
  }

  // Count numbers
  const numberCount = (domainBase.match(/\d/g) || []).length;
  const numberRatio = numberCount / domainBase.length;
  if (numberRatio > 0.3) {
    totalPenalty += 15;
    issues.push('troppi numeri');
  }

  // Check for random-looking patterns (consonant clusters)
  const consonantClusters = domainBase.match(/[bcdfghjklmnpqrstvwxz]{5,}/gi);
  if (consonantClusters && consonantClusters.length > 0) {
    totalPenalty += 15;
    issues.push('pattern sospetti');
  }

  // Check for suspicious keywords
  const suspiciousKeywords = ['free', 'cheap', 'discount', 'offer', 'win', 'prize', 'lucky', 'bonus', 'gratis', 'sconto', 'offerta', 'vincita', 'premio'];
  for (const keyword of suspiciousKeywords) {
    if (domainBase.includes(keyword)) {
      totalPenalty += 10;
      issues.push(`keyword sospetta "${keyword}"`);
      break;
    }
  }

  if (totalPenalty > 0) {
    return {
      passed: false,
      penalty: Math.min(totalPenalty, 40),
      message: `Pattern sospetti: ${issues.join(', ')}`,
      severity: totalPenalty >= 20 ? 'warning' : 'info',
    };
  }

  return { passed: true, penalty: 0, message: '', severity: 'info' };
}

function checkKnownSite(domain: string): CheckResult {
  const domainBase = getDomainWithoutTld(domain);

  // Check if it's exactly a known brand
  if (KNOWN_BRANDS.includes(domainBase)) {
    return {
      passed: true,
      penalty: -20, // Bonus for known brand
      message: 'Sito conosciuto e affidabile',
      severity: 'info',
    };
  }

  return { passed: true, penalty: 0, message: '', severity: 'info' };
}

// ==================== MAIN HANDLER ====================

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
  const tld = getTld(domain);
  const cacheKey = getCacheKey('heuristics', domain);

  // Check cache first
  const cached = await getCached<HeuristicsResult>(cacheKey);
  if (cached) {
    return res.status(200).json({ result: cached });
  }

  // Run all checks
  const checks = [
    { name: 'typosquatting', result: checkTyposquatting(domain) },
    { name: 'tld', result: checkSuspiciousTld(tld) },
    { name: 'length', result: checkDomainLength(domain) },
    { name: 'patterns', result: checkSuspiciousPatterns(domain) },
    { name: 'knownSite', result: checkKnownSite(domain) },
  ];

  // Calculate total penalty
  let totalPenalty = 0;
  const warnings: string[] = [];
  const dangers: string[] = [];

  for (const check of checks) {
    totalPenalty += check.result.penalty;
    if (check.result.message) {
      if (check.result.severity === 'danger') {
        dangers.push(check.result.message);
      } else if (check.result.severity === 'warning') {
        warnings.push(check.result.message);
      }
    }
  }

  // Calculate final score (start from 100, subtract penalties)
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));

  // Determine status and message
  let status: string;
  let message: string;

  if (dangers.length > 0) {
    status = 'danger';
    message = dangers[0];
  } else if (warnings.length > 0) {
    status = 'warning';
    message = warnings[0];
  } else if (score >= 90) {
    status = 'safe';
    message = 'Nessun pattern sospetto rilevato';
  } else {
    status = 'safe';
    message = 'Dominio nella norma';
  }

  // Build details
  const details: Record<string, unknown> = {
    domain,
    tld,
    checks: checks.reduce((acc, c) => {
      acc[c.name] = {
        passed: c.result.passed,
        penalty: c.result.penalty,
        message: c.result.message || null,
      };
      return acc;
    }, {} as Record<string, unknown>),
  };

  // Add all warnings/dangers to details
  if (warnings.length > 0) {
    details.warnings = warnings;
  }
  if (dangers.length > 0) {
    details.dangers = dangers;
  }

  const result: HeuristicsResult = {
    type: 'heuristics',
    status,
    score,
    weight: 10,
    message,
    details,
  };

  // Cache the result (heuristics are static, can cache for long time)
  await setCache(cacheKey, result, CACHE_TTL.HEURISTICS);

  return res.status(200).json({ result });
}
