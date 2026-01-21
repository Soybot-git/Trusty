export const environment = {
  production: true,
  useMocks: true, // Set to false when real APIs are configured
  apiBaseUrl: '/api', // Same domain, Vercel handles routing
  cacheTimeout: 24 * 60 * 60 * 1000, // 24 hours in ms
};
