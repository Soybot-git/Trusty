import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCached, setCache, getCacheKey, CACHE_TTL } from './lib/cache.js';

interface WhoisResult {
  type: string;
  status: string;
  score: number;
  weight: number;
  message: string;
  details: {
    domainAge: number | null;
    registrar: string | null;
    creationDate: string | null;
    expirationDate: string | null;
    source?: string;
    error?: string;
  };
}

interface RdapEvent {
  eventAction: string;
  eventDate: string;
}

interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown[];
  publicIds?: { type: string; identifier: string }[];
}

interface RdapResponse {
  events?: RdapEvent[];
  entities?: RdapEntity[];
  status?: string[];
  name?: string;
  ldhName?: string;
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

function getTld(domain: string): string {
  const parts = domain.split('.');
  return parts[parts.length - 1].toLowerCase();
}

function getRdapUrlsForDomain(domain: string): string[] {
  const tld = getTld(domain);

  // TLD-specific RDAP servers that are known to work
  const tldServers: Record<string, string> = {
    'com': `https://rdap.verisign.com/com/v1/domain/${domain}`,
    'net': `https://rdap.verisign.com/net/v1/domain/${domain}`,
    'org': `https://rdap.publicinterestregistry.org/rdap/domain/${domain}`,
    'eu': `https://rdap.eu/domain/${domain}`,
    'nl': `https://rdap.sidn.nl/domain/${domain}`,
  };

  const urls: string[] = [];

  // Add TLD-specific server first if available
  if (tldServers[tld]) {
    urls.push(tldServers[tld]);
  }

  // Add generic fallback
  urls.push(`https://rdap.org/domain/${domain}`);

  return urls;
}

// Fallback: try to get creation date from who.is (scraping)
async function getCreationDateFromWhoIs(domain: string): Promise<{ created: string | null; registrar: string | null }> {
  try {
    const response = await fetch(`https://who.is/whois/${domain}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return { created: null, registrar: null };
    }

    const html = await response.text();

    // Extract creation date using regex patterns
    let created: string | null = null;
    let registrar: string | null = null;

    // Look for common patterns in WHOIS data
    const createdPatterns = [
      /Creation Date:\s*(\d{4}-\d{2}-\d{2})/i,
      /Created:\s*(\d{4}-\d{2}-\d{2})/i,
      /Created Date:\s*(\d{4}-\d{2}-\d{2})/i,
      /Registration Date:\s*(\d{4}-\d{2}-\d{2})/i,
      /Created:\s*(\d{2}\/\d{2}\/\d{4})/i,
      /Created:\s*(\d{4}\.\d{2}\.\d{2})/i,
    ];

    for (const pattern of createdPatterns) {
      const match = html.match(pattern);
      if (match) {
        created = match[1];
        // Normalize date format
        if (created.includes('/')) {
          const [day, month, year] = created.split('/');
          created = `${year}-${month}-${day}`;
        } else if (created.includes('.')) {
          created = created.replace(/\./g, '-');
        }
        break;
      }
    }

    // Extract registrar
    const registrarMatch = html.match(/Registrar:\s*([^\n<]+)/i);
    if (registrarMatch) {
      registrar = registrarMatch[1].trim();
    }

    return { created, registrar };
  } catch {
    return { created: null, registrar: null };
  }
}

function calculateDomainAge(creationDate: string): number {
  const created = new Date(creationDate);
  const now = new Date();
  const diffTime = now.getTime() - created.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

function getScoreFromAge(ageDays: number): { score: number; status: string; message: string } {
  if (ageDays < 30) {
    return { score: 10, status: 'danger', message: 'Dominio creato da meno di 1 mese' };
  } else if (ageDays < 90) {
    return { score: 30, status: 'danger', message: 'Dominio creato da meno di 3 mesi' };
  } else if (ageDays < 180) {
    return { score: 50, status: 'warning', message: 'Dominio creato da meno di 6 mesi' };
  } else if (ageDays < 365) {
    return { score: 70, status: 'warning', message: 'Dominio attivo da meno di 1 anno' };
  } else if (ageDays < 730) {
    return { score: 85, status: 'safe', message: 'Dominio attivo da più di 1 anno' };
  } else {
    return { score: 100, status: 'safe', message: `Dominio attivo da ${Math.floor(ageDays / 365)} anni` };
  }
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
  const cacheKey = getCacheKey('whois', domain);

  // Check cache first
  const cached = await getCached<WhoisResult>(cacheKey);
  if (cached) {
    return res.status(200).json({ result: cached });
  }

  try {
    // Get RDAP URLs prioritized for this domain's TLD
    const rdapUrls = getRdapUrlsForDomain(domain);

    let data: RdapResponse | null = null;
    let lastError: string = '';

    for (const rdapUrl of rdapUrls) {
      try {
        const response = await fetch(rdapUrl, {
          headers: {
            'Accept': 'application/rdap+json',
            'User-Agent': 'Trusty/1.0 (https://trusty.vercel.app)',
          },
        });

        if (response.ok) {
          data = await response.json();
          console.log(`RDAP success from: ${rdapUrl}`);
          break;
        } else {
          lastError = `${rdapUrl}: ${response.status}`;
          console.log(`RDAP failed: ${lastError}`);
        }
      } catch (e) {
        lastError = `${rdapUrl}: ${e instanceof Error ? e.message : 'failed'}`;
        console.log(`RDAP error: ${lastError}`);
      }
    }

    // If RDAP failed, try who.is fallback
    if (!data) {
      console.log('RDAP failed, trying who.is fallback...');
      const whoIsData = await getCreationDateFromWhoIs(domain);

      if (whoIsData.created) {
        const domainAge = calculateDomainAge(whoIsData.created);
        const { score, status, message } = getScoreFromAge(domainAge);

        const result: WhoisResult = {
          type: 'whois',
          status,
          score,
          weight: 10,
          message,
          details: {
            domainAge,
            registrar: whoIsData.registrar || 'Sconosciuto',
            creationDate: whoIsData.created,
            expirationDate: null,
            source: 'who.is',
          },
        };

        // Cache the result
        await setCache(cacheKey, result, CACHE_TTL.WHOIS);

        return res.status(200).json({ result });
      }

      throw new Error(`All RDAP sources failed and who.is fallback failed. Last RDAP: ${lastError}`);
    }

    // Extract creation and expiration dates
    // Different RDAP servers use different eventAction names
    let creationDate: string | null = null;
    let expirationDate: string | null = null;

    if (data.events) {
      for (const event of data.events) {
        const action = event.eventAction.toLowerCase();
        // Handle various naming conventions
        if (action === 'registration' || action === 'created' || action === 'creation') {
          creationDate = event.eventDate;
        } else if (action === 'expiration' || action === 'expired') {
          expirationDate = event.eventDate;
        }
      }
    }

    console.log(`Domain: ${domain}, Creation: ${creationDate}, Expiration: ${expirationDate}`);

    // Extract registrar
    let registrar = 'Sconosciuto';
    if (data.entities) {
      const registrarEntity = data.entities.find((e) => e.roles?.includes('registrar'));
      if (registrarEntity?.publicIds?.[0]?.identifier) {
        registrar = registrarEntity.publicIds[0].identifier;
      } else if (registrarEntity?.vcardArray?.[1]) {
        const vcard = registrarEntity.vcardArray[1] as unknown[][];
        const fnEntry = vcard.find((v) => v[0] === 'fn');
        if (fnEntry) {
          registrar = String(fnEntry[3]);
        }
      }
    }

    if (!creationDate) {
      const result: WhoisResult = {
        type: 'whois',
        status: 'warning',
        score: 50,
        weight: 10,
        message: 'Data di creazione non disponibile',
        details: {
          domainAge: null,
          registrar,
          creationDate: null,
          expirationDate,
        },
      };

      // Cache even partial results (shorter TTL for warnings)
      await setCache(cacheKey, result, CACHE_TTL.WHOIS / 30); // 1 day for warnings

      return res.status(200).json({ result });
    }

    const domainAge = calculateDomainAge(creationDate);
    const { score, status, message } = getScoreFromAge(domainAge);

    const result: WhoisResult = {
      type: 'whois',
      status,
      score,
      weight: 10,
      message,
      details: {
        domainAge,
        registrar,
        creationDate: creationDate.split('T')[0],
        expirationDate: expirationDate?.split('T')[0] || null,
      },
    };

    // Cache the result
    await setCache(cacheKey, result, CACHE_TTL.WHOIS);

    return res.status(200).json({ result });
  } catch (error) {
    console.error('RDAP error:', error);

    return res.status(200).json({
      result: {
        type: 'whois',
        status: 'warning',
        score: 50,
        weight: 10,
        message: 'Impossibile verificare età del dominio',
        details: {
          domainAge: null,
          registrar: null,
          creationDate: null,
          expirationDate: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
    });
  }
}
