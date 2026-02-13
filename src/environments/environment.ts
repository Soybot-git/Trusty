export const environment = {
  production: false,
  apiBaseUrl: '/api',
  cacheTimeout: 24 * 60 * 60 * 1000, // 24 hours in ms
  disableCache: false, // TODO: set to false when done testing
  analytics: {
    enabled: false,  // Disabled in development
    debug: true
  }
};
