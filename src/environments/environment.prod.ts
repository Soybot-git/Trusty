export const environment = {
  production: true,
  useMocks: false,
  apiBaseUrl: '/api', // Same domain, Vercel handles routing
  cacheTimeout: 24 * 60 * 60 * 1000, // 24 hours in ms
};
