import { Redis } from '@upstash/redis';

// Initialize Redis client (lazy initialization)
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env['UPSTASH_REDIS_REST_URL'];
  const token = process.env['UPSTASH_REDIS_REST_TOKEN'];

  if (!url || !token) {
    console.warn('Redis not configured: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN missing');
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

/**
 * Get a cached value from Redis
 * @param key - The cache key
 * @returns The cached value or null if not found
 */
export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const client = getRedis();
    if (!client) return null;

    const cached = await client.get<T>(key);
    if (cached) {
      console.log(`Cache HIT: ${key}`);
      return cached;
    }
    console.log(`Cache MISS: ${key}`);
    return null;
  } catch (error) {
    console.error('Redis get error:', error);
    return null;
  }
}

/**
 * Set a value in Redis cache with TTL
 * @param key - The cache key
 * @param value - The value to cache
 * @param ttlSeconds - Time to live in seconds
 */
export async function setCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const client = getRedis();
    if (!client) return;

    await client.set(key, value, { ex: ttlSeconds });
    console.log(`Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
  } catch (error) {
    console.error('Redis set error:', error);
  }
}

/**
 * Generate a cache key for a domain and check type
 * @param type - The type of check (e.g., 'whois', 'ssl', 'ipqs')
 * @param domain - The domain being checked
 * @returns A formatted cache key
 */
export function getCacheKey(type: string, domain: string): string {
  // Normalize domain to lowercase and remove www prefix
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
  return `trusty:${type}:${normalizedDomain}`;
}

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  WHOIS: 30 * 24 * 60 * 60,      // 30 days
  SSL: 7 * 24 * 60 * 60,         // 7 days
  HEURISTICS: 30 * 24 * 60 * 60, // 30 days
  SAFE_BROWSING: 24 * 60 * 60,   // 24 hours
  IPQS: 24 * 60 * 60,            // 24 hours
  REVIEWS: 6 * 60 * 60,          // 6 hours
} as const;
