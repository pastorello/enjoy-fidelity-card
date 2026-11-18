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

/** How the stubbed `scan()` ends: `'ok'` resolves, any other value rejects with that DOMException. */
export type StubScanOutcome = 'ok' | 'NotAllowedError' | 'NotSupportedError' | 'NotReadableError';

export type StubWebNfcOptions = {
  /** False simulates iPhone: no `NDEFReader` at all. Default true. */
  supported?: boolean;
  /** What `navigator.permissions.query({ name: 'nfc' })` answers. Default `'granted'`. */
  permission?: 'granted' | 'prompt' | 'denied';
  /** How every `scan()` ends. Default `'ok'`. */
  scan?: StubScanOutcome;
};

/**
 * Web NFC as Chrome for Android would offer it (SPEC-card-input, Testing Strategy): Chromium on the
 * desktop has neither `NDEFReader` nor the `nfc` permission. Installed with `page.addInitScript`, so
 * call it before `page.goto`. A successful scan from `prompt` grants the permission, like Chrome; a
 * scan rejected with `NotAllowedError` denies it. No card is ever read: reads come from
 * `window.__enjoyFakeCard`.
 */
export async function stubWebNfc(page: Page, options: StubWebNfcOptions = {}): Promise<void> {
  await page.addInitScript(
    ({ supported, permission: initial, scan: outcome }) => {
      if (!supported) {
        Reflect.deleteProperty(window, 'NDEFReader');
        return;
      }
      let permission = initial;
      class StubNDEFReader extends EventTarget {
        onreading: ((event: Event) => void) | null = null;
        onreadingerror: ((event: Event) => void) | null = null;
        scan(scanOptions: { signal?: AbortSignal } = {}): Promise<void> {
          if (scanOptions.signal?.aborted) {
            return Promise.reject(new DOMException('The scan was aborted.', 'AbortError'));
          }
          if (outcome === 'NotAllowedError') permission = 'denied';
          if (outcome !== 'ok') return Promise.reject(new DOMException('Stub scan.', outcome));
          if (permission === 'prompt') permission = 'granted';
          return Promise.resolve();
        }
        write(): Promise<void> {
          return Promise.reject(new DOMException('No card in the stub.', 'NotReadableError'));
        }
      }
      Reflect.set(window, 'NDEFReader', StubNDEFReader);
      const permissions = navigator.permissions;
      const query = permissions.query.bind(permissions);
      // Only `state` is read by the app (webNfcAdapter.ts); other permissions keep the real query.
      Object.defineProperty(permissions, 'query', {
        value: (descriptor: PermissionDescriptor) => {
          // 'nfc' is not a PermissionName in TypeScript's lib.dom.
          const name: string = descriptor.name;
          return name === 'nfc' ? Promise.resolve({ state: permission }) : query(descriptor);
        },
      });
    },
    {
      supported: options.supported ?? true,
      permission: options.permission ?? 'granted',
      scan: options.scan ?? 'ok',
    },
  );
}
