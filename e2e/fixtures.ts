import { test as base, expect } from '@playwright/test';

/** Fails the test on any console error or warning, or page error (CSP and header problems included). */
export const test = base.extend<{ consoleErrors: string[]; onlyLocalSupabase: void }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        // Rejected sign-in attempts are an expected 400 from Auth, logged by the browser.
        const rejectedSignIn =
          message.text().startsWith('Failed to load resource') &&
          message.location().url.includes('/auth/v1/token');
        if (rejectedSignIn) return;
        if (message.type() === 'error' || message.type() === 'warning') {
          errors.push(`${message.type()}: ${message.text()}`);
        }
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await use(errors);
      expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
  /** Fails the test if the app talks to a hosted Supabase project (staging or production). */
  onlyLocalSupabase: [
    async ({ page }, use) => {
      const hosted: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).hostname.endsWith('.supabase.co')) hosted.push(request.url());
      });
      await use();
      expect(hosted, 'requests to a hosted Supabase project').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
