// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  WHOIS: 30 * 24 * 60 * 60,      // 30 days
  SSL: 7 * 24 * 60 * 60,         // 7 days
  HEURISTICS: 30 * 24 * 60 * 60, // 30 days
  SAFE_BROWSING: 24 * 60 * 60,   // 24 hours
  IPQS: 24 * 60 * 60,            // 24 hours
  REVIEWS: 6 * 60 * 60,          // 6 hours
} as const;

// Redis client (lazy loaded)
let redisClient: any = null;
let redisLoadAttempted = false;

async function getRedis(): Promise<any> {
  // Only try to load once
  if (redisLoadAttempted) return redisClient;
  redisLoadAttempted = true;

  const url = process.env['UPSTASH_REDIS_REST_URL'];
  const token = process.env['UPSTASH_REDIS_REST_TOKEN'];

  if (!url || !token) {
    console.warn('Redis not configured: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN missing');
    return null;
  }

  try {
    // Dynamic import to avoid bundling issues
    const { Redis } = await import('@upstash/redis');
    redisClient = new Redis({ url, token });
    console.log('Redis client initialized successfully');
    return redisClient;
  } catch (error) {
    console.error('Failed to load @upstash/redis:', error);
    return null;
  }
}

/**
 * Get a cached value from Redis
 */
export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const client = await getRedis();
    if (!client) return null;

    const cached = await client.get(key) as T | null;
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
 */
export async function setCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const client = await getRedis();
    if (!client) return;

    await client.set(key, value, { ex: ttlSeconds });
    console.log(`Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
  } catch (error) {
    console.error('Redis set error:', error);
  }
}

/**
 * Generate a cache key for a domain and check type
 */
export function getCacheKey(type: string, domain: string): string {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
  return `trusty:${type}:${normalizedDomain}`;
}
