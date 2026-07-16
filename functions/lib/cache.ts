export const CACHE_TTL = {
  WHOIS: 2592000,
  SSL: 604800,
  HEURISTICS: 2592000,
  SAFE_BROWSING: 86400,
  REPUTATION: 86400,
  REVIEWS: 21600,
} as const;

export function getCacheKey(type: string, domain: string): string {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
  return `trusty:${type}:${normalizedDomain}`;
}

export async function getCached<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    const cached = await kv.get(key, 'text');
    if (cached) {
      return JSON.parse(cached) as T;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setCache<T>(kv: KVNamespace, key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch (error) {
    console.error('KV set error:', error);
  }
}
