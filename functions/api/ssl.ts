import * as tls from 'tls';
import * as net from 'net';
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
    protocol?: string;
    error?: string;
  };
}

interface CertificateInfo {
  isValid: boolean;
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  daysUntilExpiry: number;
  protocol: string;
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

function getCertificateInfo(domain: string): Promise<CertificateInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: domain,
        port: 443,
        servername: domain,
        rejectUnauthorized: false,
        timeout: 10000,
      },
      () => {
        const cert = socket.getPeerCertificate();

        if (!cert || Object.keys(cert).length === 0) {
          socket.destroy();
          reject(new Error('No certificate found'));
          return;
        }

        const now = new Date();
        const validTo = new Date(cert.valid_to);
        const validFrom = new Date(cert.valid_from);
        const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        const isValid = socket.authorized || (now >= validFrom && now <= validTo);

        let issuer = 'Sconosciuto';
        if (cert.issuer) {
          issuer = cert.issuer.O || cert.issuer.CN || 'Sconosciuto';
        }

        let subject = domain;
        if (cert.subject) {
          subject = cert.subject.CN || domain;
        }

        const protocol = socket.getProtocol() || 'TLS';

        socket.destroy();

        resolve({
          isValid,
          issuer,
          subject,
          validFrom: validFrom.toISOString().split('T')[0],
          validTo: validTo.toISOString().split('T')[0],
          daysUntilExpiry,
          protocol,
        });
      }
    );

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    });
  });
}

function getScoreFromCertificate(cert: CertificateInfo): { score: number; status: string; message: string } {
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
  const kv = env.TRUSTY_KV;
  const cacheKey = getCacheKey('ssl', domain);

  const cached = await getCached<SslResult>(kv, cacheKey);
  if (cached) {
    return new Response(JSON.stringify({ result: cached }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  try {
    const cert = await getCertificateInfo(domain);
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
        protocol: cert.protocol,
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

    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
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

    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('timeout')) {
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
