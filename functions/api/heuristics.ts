import { getCached, setCache, getCacheKey, CACHE_TTL } from '../lib/cache';
import type { Env } from '../lib/types';

interface HeuristicsResult {
  type: string;
  status: string;
  score: number;
  weight: number;
  message: string;
  details: Record<string, unknown>;
}

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

const SUSPICIOUS_TLDS = [
  'xyz', 'top', 'click', 'work', 'link', 'gq', 'ml', 'cf', 'ga', 'tk',
  'buzz', 'surf', 'monster', 'quest', 'sbs', 'cfd', 'boats', 'cam',
  'icu', 'cyou', 'rest', 'beauty', 'hair', 'skin', 'makeup',
  'bar', 'loan', 'racing', 'review', 'cricket', 'win', 'bid',
  'stream', 'download', 'accountant', 'science', 'date', 'faith',
];

const TRUSTED_TLDS = [
  'it', 'com', 'org', 'net', 'eu', 'gov', 'edu',
  'co.uk', 'de', 'fr', 'es', 'nl', 'be', 'at', 'ch',
];

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
    parts.pop();
  }
  return parts.join('.');
}

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

function normalizeDomain(domain: string): string {
  let normalized = domain.toLowerCase();

  for (const [original, substitutes] of Object.entries(CHAR_SUBSTITUTIONS)) {
    for (const sub of substitutes) {
      normalized = normalized.split(sub).join(original);
    }
  }

  normalized = normalized.replace(/[-_]/g, '').replace(/\d/g, '');

  return normalized;
}

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
    if (normalized === brand && domainBase !== brand) {
      return {
        passed: false,
        penalty: 50,
        message: `Possibile typosquatting: simile a "${brand}"`,
        severity: 'danger',
      };
    }

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
      penalty: -5,
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

  const hyphenCount = (domainBase.match(/-/g) || []).length;
  if (hyphenCount >= 3) {
    totalPenalty += 20;
    issues.push('troppi trattini');
  } else if (hyphenCount >= 2) {
    totalPenalty += 10;
    issues.push('molti trattini');
  }

  const numberCount = (domainBase.match(/\d/g) || []).length;
  const numberRatio = numberCount / domainBase.length;
  if (numberRatio > 0.3) {
    totalPenalty += 15;
    issues.push('troppi numeri');
  }

  const consonantClusters = domainBase.match(/[bcdfghjklmnpqrstvwxz]{5,}/gi);
  if (consonantClusters && consonantClusters.length > 0) {
    totalPenalty += 15;
    issues.push('pattern sospetti');
  }

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

  if (KNOWN_BRANDS.includes(domainBase)) {
    return {
      passed: true,
      penalty: -20,
      message: 'Sito conosciuto e affidabile',
      severity: 'info',
    };
  }

  return { passed: true, penalty: 0, message: '', severity: 'info' };
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

  const domain = extractDomain(url);
  const tld = getTld(domain);
  const kv = env.TRUSTY_KV;
  const cacheKey = getCacheKey('heuristics', domain);

  const cached = await getCached<HeuristicsResult>(kv, cacheKey);
  if (cached) {
    return new Response(JSON.stringify({ result: cached }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  const checks = [
    { name: 'typosquatting', result: checkTyposquatting(domain) },
    { name: 'tld', result: checkSuspiciousTld(tld) },
    { name: 'length', result: checkDomainLength(domain) },
    { name: 'patterns', result: checkSuspiciousPatterns(domain) },
    { name: 'knownSite', result: checkKnownSite(domain) },
  ];

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

  const score = Math.max(0, Math.min(100, 100 - totalPenalty));

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

  if (warnings.length > 0) {
    details['warnings'] = warnings;
  }
  if (dangers.length > 0) {
    details['dangers'] = dangers;
  }

  const result: HeuristicsResult = {
    type: 'heuristics',
    status,
    score,
    weight: 10,
    message,
    details,
  };

  await setCache(kv, cacheKey, result, CACHE_TTL.HEURISTICS);

  return new Response(JSON.stringify({ result }), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
  });
};
