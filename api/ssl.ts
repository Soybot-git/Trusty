import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as tls from 'tls';
import * as net from 'net';
import { getCached, setCache, getCacheKey, CACHE_TTL } from './lib/cache.js';

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
        servername: domain, // SNI support
        rejectUnauthorized: false, // Allow self-signed to get info
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

        // Check if certificate is valid (not expired and not yet valid)
        const isValid = socket.authorized || (now >= validFrom && now <= validTo);

        // Extract issuer organization
        let issuer = 'Sconosciuto';
        if (cert.issuer) {
          issuer = cert.issuer.O || cert.issuer.CN || 'Sconosciuto';
        }

        // Extract subject
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
  const cacheKey = getCacheKey('ssl', domain);

  // Check cache first
  const cached = await getCached<SslResult>(cacheKey);
  if (cached) {
    return res.status(200).json({ result: cached });
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

    // Cache the result
    await setCache(cacheKey, result, CACHE_TTL.SSL);

    return res.status(200).json({ result });
  } catch (error) {
    console.error('SSL check error:', error);

    // If we can't connect via HTTPS, the site might not have SSL
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
      return res.status(200).json({
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
      });
    }

    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('timeout')) {
      return res.status(200).json({
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
      });
    }

    return res.status(200).json({
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
    });
  }
}
