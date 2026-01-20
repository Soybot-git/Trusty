/**
 * Mock data and URL pattern matching for testing all UI scenarios.
 *
 * Pattern matching:
 * - *amazon*, *ebay*, *zalando* → 🟢 85-95/100
 * - *test-safe* → 🟢 80/100
 * - *test-caution* → 🟡 55/100
 * - *test-danger* → 🔴 25/100
 * - *scam*, *fake*, *truffa* → 🔴 10/100
 * - Others → random 40-80
 */

export interface MockScenario {
  pattern: RegExp;
  safeBrowsing: { isMalware: boolean; isPhishing: boolean };
  domainAgeDays: number;
  sslValid: boolean;
  fraudScore: number;
  reviewRating: number;
  reviewCount: number;
  hasVat: boolean;
  hasCryptoOnly: boolean;
}

export const MOCK_SCENARIOS: MockScenario[] = [
  // Trusted sites
  {
    pattern: /amazon|ebay|zalando|mediaworld|unieuro/i,
    safeBrowsing: { isMalware: false, isPhishing: false },
    domainAgeDays: 365 * 10,
    sslValid: true,
    fraudScore: 5,
    reviewRating: 4.2,
    reviewCount: 50000,
    hasVat: true,
    hasCryptoOnly: false,
  },
  // Test safe
  {
    pattern: /test-safe/i,
    safeBrowsing: { isMalware: false, isPhishing: false },
    domainAgeDays: 365 * 2,
    sslValid: true,
    fraudScore: 15,
    reviewRating: 4.0,
    reviewCount: 500,
    hasVat: true,
    hasCryptoOnly: false,
  },
  // Test caution
  {
    pattern: /test-caution/i,
    safeBrowsing: { isMalware: false, isPhishing: false },
    domainAgeDays: 90,
    sslValid: true,
    fraudScore: 45,
    reviewRating: 3.0,
    reviewCount: 50,
    hasVat: false,
    hasCryptoOnly: false,
  },
  // Test danger
  {
    pattern: /test-danger/i,
    safeBrowsing: { isMalware: false, isPhishing: false },
    domainAgeDays: 15,
    sslValid: false,
    fraudScore: 80,
    reviewRating: 1.5,
    reviewCount: 10,
    hasVat: false,
    hasCryptoOnly: true,
  },
  // Scam sites
  {
    pattern: /scam|fake|truffa|phishing/i,
    safeBrowsing: { isMalware: true, isPhishing: true },
    domainAgeDays: 7,
    sslValid: false,
    fraudScore: 95,
    reviewRating: 1.0,
    reviewCount: 5,
    hasVat: false,
    hasCryptoOnly: true,
  },
];

export function getScenarioForUrl(url: string): MockScenario {
  for (const scenario of MOCK_SCENARIOS) {
    if (scenario.pattern.test(url)) {
      return scenario;
    }
  }

  // Default: random scenario
  const randomScore = Math.random();
  return {
    pattern: /.*/,
    safeBrowsing: { isMalware: false, isPhishing: false },
    domainAgeDays: Math.floor(Math.random() * 365 * 3) + 30,
    sslValid: randomScore > 0.2,
    fraudScore: Math.floor(Math.random() * 50) + 10,
    reviewRating: 2.5 + Math.random() * 2,
    reviewCount: Math.floor(Math.random() * 1000) + 10,
    hasVat: randomScore > 0.4,
    hasCryptoOnly: randomScore < 0.1,
  };
}

/**
 * Simulates realistic API latency (200-800ms)
 */
export function simulateLatency(): Promise<void> {
  const delay = 200 + Math.random() * 600;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Extracts domain from URL
 */
export function extractDomain(url: string): string {
  try {
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    const urlObj = new URL(normalizedUrl);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * Gets TLD from domain
 */
export function getTld(domain: string): string {
  const parts = domain.split('.');
  return parts[parts.length - 1] || '';
}
