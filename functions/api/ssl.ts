import { getCached, setCache, getCacheKey, CACHE_TTL } from '../lib/cache';
import type { Env } from '../lib/types';

interface SslResult {
  type: string;
  status: string;
  score: number;
  weight: number;
  message: string;
  details: {
    isValid: boolean;
    issuer?: string;
    subject?: string;
    expiresAt?: string;
    daysUntilExpiry?: number;
    error?: string;
  };
}

interface CertistCertificate {
  isValid: boolean;
  issuer: string;
  subject: string;
  validTo: string;
  daysUntilExpiry: number;
}

function extractDomain(url: string): string {
  try {
    let normalized = url.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    const urlObj = new URL(normalized);
    return urlObj.hostname;
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }
}

const CERTIST_API_BASE = 'https://api.cert.ist';
const FETCH_TIMEOUT_MS = 10000;

async function fetchCertificateFromCertIst(domain: string): Promise<CertistCertificate> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${CERTIST_API_BASE}/${domain}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('ENOTFOUND');
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;

    const certificate = data?.certificate as Record<string, unknown> | undefined;
    const validityDates = certificate?.validity_dates as Record<string, string> | undefined;
    const chain = (data?.chain as Array<Record<string, unknown>>) || [];

    if (!validityDates || !validityDates.not_after) {
      throw new Error('No certificate found');
    }

    const now = new Date();
    const notBefore = new Date(validityDates.not_before);
    const notAfter = new Date(validityDates.not_after);
    const daysUntilExpiry = Math.floor((notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const isValid = now >= notBefore && now <= notAfter;

    const leaf = (chain[0]?.components as Record<string, string> | undefined) || {};
    const subject = leaf.CN || domain;

    const issuerCert = (chain[1]?.components as Record<string, string> | undefined) || {};
    const issuer = issuerCert.O || issuerCert.CN || 'Sconosciuto';

    const validTo = validityDates.not_after.split('T')[0];

    return { isValid, issuer, subject, validTo, daysUntilExpiry };
  } finally {
    clearTimeout(timeout);
  }
}

function getScoreFromCertificate(cert: CertistCertificate): { score: number; status: string; message: string } {
  if (!cert.isValid) {
    return { score: 0, status: 'danger', message: 'Certificato SSL non valido o scaduto' };
  }

  if (cert.daysUntilExpiry < 0) {
    return { score: 0, status: 'danger', message: 'Certificato SSL scaduto' };
  }

  if (cert.daysUntilExpiry < 7) {
    return { score: 30, status: 'danger', message: `Certificato SSL scade tra ${cert.daysUntilExpiry} giorni` };
  }

  if (cert.daysUntilExpiry < 30) {
    return { score: 60, status: 'warning', message: `Certificato SSL scade tra ${cert.daysUntilExpiry} giorni` };
  }

  if (cert.daysUntilExpiry < 90) {
    return { score: 80, status: 'safe', message: 'Certificato SSL valido' };
  }

  return { score: 100, status: 'safe', message: 'Certificato SSL valido e sicuro' };
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

  let url: string | undefined;
  try {
    ({ url } = await request.json() as { url?: string });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

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
  const kv = env.TRUSTY_KV;
  const cacheKey = getCacheKey('ssl', domain);

  try {
    const cached = await getCached<SslResult>(kv, cacheKey);
    if (cached) {
      return new Response(JSON.stringify({ result: cached }), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }
  } catch {
    // Se KV non è disponibile, procedi senza cache
  }

  try {
    const cert = await fetchCertificateFromCertIst(domain);
    const { score, status, message } = getScoreFromCertificate(cert);

    const result: SslResult = {
      type: 'ssl',
      status,
      score,
      weight: 20,
      message,
      details: {
        isValid: cert.isValid,
        issuer: cert.issuer,
        subject: cert.subject,
        expiresAt: cert.validTo,
        daysUntilExpiry: cert.daysUntilExpiry,
      },
    };

    await setCache(kv, cacheKey, result, CACHE_TTL.SSL);

    return new Response(JSON.stringify({ result }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('SSL check error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage === 'ENOTFOUND') {
      return new Response(JSON.stringify({
        result: {
          type: 'ssl',
          status: 'danger',
          score: 0,
          weight: 20,
          message: 'Dominio non trovato',
          details: {
            isValid: false,
            error: 'Domain not found',
          },
        },
      }), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      return new Response(JSON.stringify({
        result: {
          type: 'ssl',
          status: 'danger',
          score: 0,
          weight: 20,
          message: 'Connessione HTTPS non disponibile',
          details: {
            isValid: false,
            error: 'HTTPS connection refused',
          },
        },
      }), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    return new Response(JSON.stringify({
      result: {
        type: 'ssl',
        status: 'warning',
        score: 50,
        weight: 20,
        message: 'Impossibile verificare certificato SSL',
        details: {
          isValid: false,
          error: errorMessage,
        },
      },
    }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }
};
