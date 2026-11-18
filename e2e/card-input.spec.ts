import { signIn } from './auth';
import { expect, test } from './fixtures';
import { fakeCardWrites } from './nfc';

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

test('the E2E build exposes the fake writer: an empty write log and the test controls', async ({
  page,
}) => {
  await signIn(page);
  expect(await page.evaluate(() => Array.isArray(window.__enjoyFakeCardWrites))).toBe(true);
  expect(
    await page.evaluate(() => [
      typeof window.__enjoyFakeCardControl?.failNextWrite,
      typeof window.__enjoyFakeCardControl?.setCanWrite,
    ]),
  ).toEqual(['function', 'function']);
  expect(await fakeCardWrites(page)).toEqual([]);
});
