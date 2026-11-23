import { expect, type Page } from '@playwright/test';

/**
 * One write of the fake writer (src/features/card-input/fakeCardAdapter.ts): the link written, or
 * `null` for a card erased by «Riformatta» (SPEC-customers-v2, point 4).
 */
export type FakeCardWrite = { uid: string; url: string | null; at: number };

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
 * What the fake writer has written so far, oldest first (SPEC-card-input, point 7): the log the tests
 * read to open the link written on a card (`url: null` for an erased card). Fails if the page is not
 * an E2E build.
 */
export async function fakeCardWrites(page: Page): Promise<FakeCardWrite[]> {
  return page.evaluate(() => {
    const writes = window.__enjoyFakeCardWrites;
    if (!Array.isArray(writes)) throw new Error('Not an E2E build: no __enjoyFakeCardWrites');
    return writes.map((entry) => ({ ...entry }));
  });
}

/**
 * The cards the fake writer has erased so far, oldest first (SPEC-customers-v2, point 4: the entries
 * of the log with `url: null`), only those of `uid` when given. Fails if the page is not an E2E build.
 */
export async function fakeCardErasures(page: Page, uid?: string): Promise<FakeCardWrite[]> {
  return (await fakeCardWrites(page)).filter(
    (entry) => entry.url === null && (uid === undefined || entry.uid === uid),
  );
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

/** A 7-byte uid nobody has used yet (a uid belongs to one customer forever), canonical. */
export function freshUid(): string {
  const bytes = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  );
  return `04${bytes.join('')}`.toUpperCase();
}

/** The uid as Web NFC gives it: lower case, colon-separated. */
export function asWebNfc(uid: string): string {
  return (uid.toLowerCase().match(/../g) ?? []).join(':');
}

export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * After «Salva cliente» with a card, the link is written on it (SPEC-cards, point 8), then `next`
 * opens. The fake writer writes at once only on a card tapped less than 1.5 s before (IN_FIELD_MS):
 * when the form took longer, the write asks for the card («Avvicina la card …») and it is tapped
 * again, as the operator would. Returns when the card was last tapped (null: not tapped here).
 */
export async function writeAfterSave(page: Page, uid: string, next: string | RegExp) {
  const again = page
    .getByRole('region', { name: 'Scrittura del link' })
    .getByText(`Avvicina la card …${uid.slice(-4)}`);
  let lastTap: number | null = null;
  await expect(async () => {
    if (await again.isVisible()) {
      lastTap = Date.now();
      await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
    }
    await expect(page).toHaveURL(next, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  return lastTap;
}

/**
 * Registers a customer with a new card from the home, as at the till; returns its id, its name and
 * when the card was last tapped (the reader ignores the same uid for REPEAT_WINDOW_MS after it).
 */
export async function customerWithCard(page: Page, prefix: string, uid: string) {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Lettura card' })).toContainText(
    'Avvicina la card',
  );
  const firstTap = Date.now();
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  await expect(page).toHaveURL(`/clienti/nuovo?card=${uid}`);
  const name = uniqueName(prefix);
  await page.getByRole('textbox', { name: 'Nome e cognome' }).fill(name);
  await page.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ }).check();
  await page.getByRole('button', { name: 'Salva cliente' }).click();
  const lastTap = (await writeAfterSave(page, uid, /\/clienti\/[0-9a-f-]{36}\/spesa$/)) ?? firstTap;
  const id = /\/clienti\/([0-9a-f-]{36})\/spesa$/.exec(page.url())?.[1];
  if (id === undefined) throw new Error('No customer id in the URL');
  return { id, name, lastTap };
}

/**
 * Puts `uid` on the phone in Associa card and waits for `customerPath`. The fake writer writes at
 * once only on a card tapped less than 1.5 s before (IN_FIELD_MS): when the association took
 * longer, the write asks for the card again («Avvicina la card …») and it is tapped again.
 */
export async function tapUntilWritten(page: Page, uid: string, customerPath: string) {
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  const again = page
    .getByRole('region', { name: 'Scrittura del link' })
    .getByText(`Avvicina la card …${uid.slice(-4)}`);
  await expect(async () => {
    if (await again.isVisible()) {
      await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
    }
    await expect(page).toHaveURL(customerPath, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}
