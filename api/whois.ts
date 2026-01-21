import type { VercelRequest, VercelResponse } from '@vercel/node';

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

  // TLD-specific RDAP servers (more reliable)
  const tldServers: Record<string, string> = {
    'com': `https://rdap.verisign.com/com/v1/domain/${domain}`,
    'net': `https://rdap.verisign.com/net/v1/domain/${domain}`,
    'org': `https://rdap.publicinterestregistry.org/rdap/domain/${domain}`,
    'it': `https://rdap.nic.it/domain/${domain}`,
    'eu': `https://rdap.eu/domain/${domain}`,
    'de': `https://rdap.denic.de/domain/${domain}`,
    'uk': `https://rdap.nominet.uk/uk/domain/${domain}`,
    'fr': `https://rdap.nic.fr/domain/${domain}`,
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

    if (!data) {
      throw new Error(`All RDAP sources failed. Last: ${lastError}`);
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
      return res.status(200).json({
        result: {
          type: 'whois',
          status: 'warning',
          score: 50,
          weight: 20,
          message: 'Data di creazione non disponibile',
          details: {
            domainAge: null,
            registrar,
            creationDate: null,
            expirationDate,
          },
        },
      });
    }

    const domainAge = calculateDomainAge(creationDate);
    const { score, status, message } = getScoreFromAge(domainAge);

    return res.status(200).json({
      result: {
        type: 'whois',
        status,
        score,
        weight: 20,
        message,
        details: {
          domainAge,
          registrar,
          creationDate: creationDate.split('T')[0],
          expirationDate: expirationDate?.split('T')[0] || null,
        },
      },
    });
  } catch (error) {
    console.error('RDAP error:', error);

    return res.status(200).json({
      result: {
        type: 'whois',
        status: 'warning',
        score: 50,
        weight: 20,
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
