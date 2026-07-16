import { getCached, setCache, getCacheKey, CACHE_TTL } from '../lib/cache';
import type { Env } from '../lib/types';

interface ReputationResult {
  type: string;
  status: string;
  score: number;
  weight: number;
  message: string;
  details: {
    riskScore?: number;
    unsafe?: boolean;
    suspicious?: boolean;
    phishing?: boolean;
    malware?: boolean;
    parking?: boolean;
    spamming?: boolean;
    category?: string | null;
    error?: string;
  };
}

interface VirusTotalResponse {
  data: {
    attributes: {
      last_analysis_stats: {
        harmless: number;
        malicious: number;
        suspicious: number;
        undetected: number;
        timeout: number;
      };
      reputation: number;
      total_votes: { harmless: number; malicious: number };
      categories: Record<string, string>;
    };
  };
}

interface DerivedRiskData {
  riskScore: number;
  unsafe: boolean;
  suspicious: boolean;
  phishing: boolean;
  malware: boolean;
  parking: boolean;
  spamming: boolean;
  category: string | null;
}

function extractDomain(url: string): string {
  try {
    let normalized = url.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    const urlObj = new URL(normalized);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }
}

function deriveRiskData(vt: VirusTotalResponse): DerivedRiskData {
  const stats = vt.data.attributes.last_analysis_stats;
  const total = stats.harmless + stats.malicious + stats.suspicious + stats.undetected + stats.timeout;
  const riskScore = total > 0 ? Math.round(((stats.malicious + stats.suspicious) / total) * 100) : 0;

  const categories = vt.data.attributes.categories || {};
  const categoryValues = Object.values(categories).map(v => v.toLowerCase());

  const malware = stats.malicious >= 3;
  const phishing = stats.malicious >= 1 && categoryValues.some(c => c.includes('phishing'));
  const suspicious = stats.suspicious > 0;
  const parking = categoryValues.some(c => c.includes('parked') || c.includes('parking'));
  const unsafe = stats.malicious > 0 || stats.suspicious > 0;

  return {
    riskScore,
    unsafe,
    suspicious,
    phishing,
    malware,
    parking,
    spamming: false,
    category: categoryValues[0] || null,
  };
}

function getScoreFromRiskScore(riskScore: number, data: DerivedRiskData): { score: number; status: string; message: string } {
  if (data.malware) {
    return { score: 0, status: 'danger', message: 'Malware rilevato sul sito' };
  }

  if (data.phishing) {
    return { score: 0, status: 'danger', message: 'Sito di phishing rilevato' };
  }

  if (data.parking) {
    return { score: 20, status: 'danger', message: 'Dominio parcheggiato (non attivo)' };
  }

  if (riskScore >= 85) {
    return { score: 10, status: 'danger', message: 'Rischio molto alto rilevato' };
  }

  if (riskScore >= 75) {
    return { score: 30, status: 'danger', message: 'Rischio alto rilevato' };
  }

  if (data.suspicious || riskScore >= 50) {
    return { score: 50, status: 'warning', message: 'Alcuni elementi sospetti rilevati' };
  }

  if (riskScore >= 25) {
    return { score: 70, status: 'warning', message: 'Rischio basso rilevato' };
  }

  return { score: 100, status: 'safe', message: 'Nessun rischio significativo' };
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

  const apiKey = env.VIRUSTOTAL_API_KEY;

  if (!apiKey) {
    console.error('VIRUSTOTAL_API_KEY not configured');
    return new Response(JSON.stringify({
      result: {
        type: 'reputation',
        status: 'warning',
        score: 50,
        weight: 30,
        message: 'Verifica reputazione non disponibile',
        details: {
          error: 'API not configured',
        },
      },
    }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  const domain = extractDomain(url);
  const kv = env.TRUSTY_KV;
  const cacheKey = getCacheKey('reputation', domain);

  const cached = await getCached<ReputationResult>(kv, cacheKey);
  if (cached) {
    return new Response(JSON.stringify({ result: cached }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  try {
    const response = await fetch(
      `https://www.virustotal.com/api/v3/domains/${domain}`,
      {
        method: 'GET',
        headers: {
          'x-apikey': apiKey,
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('VirusTotal response body:', errorBody);
      throw new Error(`VirusTotal API error: ${response.status} - ${errorBody}`);
    }

    const vtData: VirusTotalResponse = await response.json();
    const data = deriveRiskData(vtData);

    const { score, status, message } = getScoreFromRiskScore(data.riskScore, data);

    const result: ReputationResult = {
      type: 'reputation',
      status,
      score,
      weight: 30,
      message,
      details: {
        riskScore: data.riskScore,
        unsafe: data.unsafe,
        suspicious: data.suspicious,
        phishing: data.phishing,
        malware: data.malware,
        parking: data.parking,
        spamming: data.spamming,
        category: data.category,
      },
    };

    await setCache(kv, cacheKey, result, CACHE_TTL.REPUTATION);

    return new Response(JSON.stringify({ result }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('VirusTotal error:', error);

    return new Response(JSON.stringify({
      result: {
        type: 'reputation',
        status: 'warning',
        score: 50,
        weight: 30,
        message: 'Impossibile verificare reputazione',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
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
