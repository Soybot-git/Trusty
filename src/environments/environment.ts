export const environment = {
  production: false,
  useMocks: true, // Set to false to use real API during development
  apiBaseUrl: '/api', // Works with Vercel dev server
  cacheTimeout: 24 * 60 * 60 * 1000, // 24 hours in ms
};
