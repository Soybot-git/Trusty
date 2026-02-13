import { ApplicationConfig, APP_INITIALIZER, isDevMode } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { inject } from '@vercel/analytics';
import { environment } from '../environments/environment';

function initializeAnalytics() {
  return () => {
    if (environment.analytics.enabled) {
      inject({
        mode: 'production',
        debug: environment.analytics.debug
      });
    }
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(withFetch()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAnalytics,
      multi: true
    }
  ],
};
