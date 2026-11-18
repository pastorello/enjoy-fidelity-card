import { signIn } from './auth';
import { expect, test } from './fixtures';

declare global {
  interface Window {
    /** Installed by the E2E build only (src/features/card-input/fakeCardAdapter.ts). */
    __enjoyFakeCard?: (uid: string) => void;
  }
}

/**
 * Card reading end to end (docs/specs/SPEC-card-input.md, Testing Strategy). Web NFC does not exist
 * in Playwright: the E2E build (VITE_E2E=1) installs the fake reader instead.
 */

test('the E2E build exposes the fake card reader once an operator is signed in', async ({
  page,
}) => {
  await signIn(page);
  expect(await page.evaluate(() => typeof window.__enjoyFakeCard)).toBe('function');
  // A read with nobody listening is dropped without errors (the fixture fails on console errors).
  await page.evaluate(() => window.__enjoyFakeCard?.('04A1B2C3D4E5F6'));
});
