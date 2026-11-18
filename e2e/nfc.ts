import type { Page } from '@playwright/test';

/** One link written by the fake writer (src/features/card-input/fakeCardAdapter.ts). */
export type FakeCardWrite = { uid: string; url: string; at: number };

declare global {
  interface Window {
    /** Installed by the E2E build only (src/features/card-input/fakeCardAdapter.ts). */
    __enjoyFakeCard?: (uid: string) => void;
    __enjoyFakeCardWrites?: FakeCardWrite[];
    __enjoyFakeCardControl?: {
      failNextWrite(
        reason: 'io' | 'timeout' | 'not-allowed' | 'verify-failed' | 'unreadable',
      ): void;
      setCanWrite(value: boolean): void;
    };
  }
}

/**
 * The links the fake writer has written so far, oldest first (SPEC-card-input, point 7): the log the
 * tests read to open the link written on a card. Fails if the page is not an E2E build.
 */
export async function fakeCardWrites(page: Page): Promise<FakeCardWrite[]> {
  return page.evaluate(() => {
    const writes = window.__enjoyFakeCardWrites;
    if (!Array.isArray(writes)) throw new Error('Not an E2E build: no __enjoyFakeCardWrites');
    return writes.map((entry) => ({ ...entry }));
  });
}
