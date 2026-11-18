import { test as base, expect } from '@playwright/test';

/** Fails the test on any console error or warning, or page error (CSP and header problems included). */
export const test = base.extend<{
  /**
   * URLs whose failed load is an answer the test expects (a refusal the app shows as a message),
   * set with `test.use` around the tests that provoke it. Empty by default.
   */
  expectedRefusals: RegExp[];
  consoleErrors: string[];
  onlyLocalSupabase: void;
}>({
  expectedRefusals: [[], { option: true }],
  consoleErrors: [
    async ({ page, expectedRefusals }, use) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        // Rejected sign-in attempts (400 on /token) and used or expired recovery links (403 on
        // /verify) are expected answers from Auth, logged by the browser.
        const failedLoad = message.text().startsWith('Failed to load resource');
        const url = message.location().url;
        const rejectedByAuth =
          failedLoad && (url.includes('/auth/v1/token') || url.includes('/auth/v1/verify'));
        if (rejectedByAuth) return;
        if (failedLoad && expectedRefusals.some((pattern) => pattern.test(url))) return;
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
