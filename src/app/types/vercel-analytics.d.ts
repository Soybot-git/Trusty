declare module '@vercel/analytics' {
  export interface AnalyticsOptions {
    mode?: 'auto' | 'development' | 'production';
    debug?: boolean;
    beforeSend?: (event: BeforeSendEvent) => BeforeSendEvent | null;
  }

  export interface BeforeSendEvent {
    url: string;
    [key: string]: any;
  }

  export function inject(options?: AnalyticsOptions): void;
  export function track(name: string, properties?: Record<string, any>): void;
}
