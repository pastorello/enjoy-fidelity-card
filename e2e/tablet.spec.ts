import type { APIRequestContext, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { SEED_PASSWORD, SEED_PINS, seedAccounts, seedDevices, signInDevice } from './auth';
import { runSql } from './db';
import { expect, test } from './fixtures';
import { asWebNfc, freshUid, uniqueName } from './nfc';
import {
  REPEAT_WINDOW_MS,
  cashierOf,
  operatorButton,
  operatorId,
  passOnUsbReader,
  readOnUsbReader,
  resetDevice,
  tapPin,
} from './tablet';

/**
 * The till tablet end to end (docs/specs/SPEC-tablet-kiosk.md, Testing Strategy; criteria 1, 2,
 * 3, 5 and 6), at 1280×800 in the `tablet` project, against the local stack. The tablet has no
 * NFC: cards come from the USB reader, a keyboard wedge, typed here with `page.keyboard` (a fast
 * burst closed by Enter, through the real adapter), and from the fake reader of the E2E build.
 * The USB format in force is the initial one (`hex`).
 */

/** Same origin as playwright.config.ts (LOCAL_SUPABASE_URL). */
const LOCAL_SUPABASE_URL = 'http://localhost:54321';

/** Types an amount on the app's keypad, digit by digit, as on a POS. */
async function typeAmount(page: Page, digits: string) {
  const keypad = page.getByRole('group', { name: 'Tastierino numerico' });
  await digits
    .split('')
    .reduce(
      (typed, digit) =>
        typed.then(() => keypad.getByRole('button', { name: digit, exact: true }).click()),
      Promise.resolve(),
    );
}

/** Every key of the PIN pad is off (Playwright does not count a disabled `fieldset` itself). */
async function expectKeypadOff(page: Page) {
  const keys = page.getByRole('group', { name: 'Tastierino PIN' }).getByRole('button');
  await expect(keys).toHaveCount(11);
  await Promise.all((await keys.all()).map((key) => expect(key).toBeDisabled()));
}

/** The publishable key and an access token of a seed account, from the local Auth. */
async function signedInApi(
  request: APIRequestContext,
  email: string,
): Promise<{ key: string; token: string }> {
  const status = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const key = /^PUBLISHABLE_KEY="?([^"\n]+)"?$/m.exec(status)?.[1];
  if (!key) throw new Error('`supabase status` printed no PUBLISHABLE_KEY.');
  const auth = await request.post(`${LOCAL_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: key },
    data: { email, password: SEED_PASSWORD },
  });
  expect(auth.ok()).toBe(true);
  const session: unknown = await auth.json();
  const token =
    typeof session === 'object' && session !== null && 'access_token' in session
      ? session.access_token
      : null;
  if (typeof token !== 'string') throw new Error('Auth gave no access token.');
  return { key, token };
}

test.describe('the till tablet, with its own device account', () => {
  // One tablet, one cashier on the server: these tests take turns on it.
  test.describe.configure({ mode: 'serial' });

  test('a card passed on /cassa does nothing: no other screen, no digit in the PIN (criterion 5)', async ({
    page,
  }) => {
    await signInDevice(page);
    // Only /cassa: the home is not reachable without a cashier (criterion 1).
    await page.goto('/');
    await expect(page).toHaveURL(/\/cassa$/);

    // Any card lookup sent from /cassa would mean the reader is on there.
    const lookups: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/rest/v1/rpc/lookup_card')) lookups.push(request.url());
    });
    // Keys that reach the document, counted on <html>: the USB wedge listens there (after
    // `window`, where /cassa stops them).
    await page.evaluate(() => {
      const root = document.documentElement;
      document.addEventListener(
        'keydown',
        () => {
          root.dataset['keysOnDocument'] = String(Number(root.dataset['keysOnDocument'] ?? 0) + 1);
        },
        { capture: true },
      );
    });

    const operator = operatorButton(page, seedAccounts.operator.name);
    await operator.click();
    await expect(operator).toHaveAttribute('aria-pressed', 'true');
    const dots = page.getByRole('complementary', { name: 'PIN' }).getByRole('img');
    await expect(dots).toHaveAccessibleName('0 cifre su 4 inserite');

    // A key of the PIN pad has the focus: the reader's Enter must not press it.
    const one = page
      .getByRole('group', { name: 'Tastierino PIN' })
      .getByRole('button', { name: '1', exact: true });
    await one.focus();
    await passOnUsbReader(page, freshUid());
    // Another operator's button has the focus: the reader's Enter must not choose them.
    const other = operatorButton(page, seedAccounts.admin.name);
    await expect(other).toHaveAttribute('aria-pressed', 'false');
    await other.focus();
    await passOnUsbReader(page, freshUid());
    await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(freshUid()));
    await page.waitForTimeout(500);

    await expect(page).toHaveURL(/\/cassa$/);
    await expect(dots).toHaveAccessibleName('0 cifre su 4 inserite');
    await expect(operator).toHaveAttribute('aria-pressed', 'true');
    await expect(other).toHaveAttribute('aria-pressed', 'false');
    expect(
      await page.evaluate(() => document.documentElement.dataset['keysOnDocument'] ?? '0'),
    ).toBe('0');
    expect(lookups).toEqual([]);
    expect(cashierOf(seedDevices.till.name)).toBe('');
  });

  test('PIN, a new card on the USB reader, then a purchase in less than 10 s by the cashier; Cambia ends the turn (criteria 2, 5 and 6)', async ({
    page,
  }) => {
    await signInDevice(page);
    await operatorButton(page, seedAccounts.operator.name).click();
    await expect(
      page.getByRole('heading', { name: `PIN di ${seedAccounts.operator.name}` }),
    ).toBeVisible();
    await tapPin(page, SEED_PINS.operator);

    // The right PIN: the home of the tablet, with the cashier in the header.
    await expect(page).toHaveURL(/\/$/);
    const chip = page.getByRole('link', {
      name: `Alla cassa: ${seedAccounts.operator.name} · Cambia`,
    });
    await expect(chip).toBeVisible();
    expect((await chip.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    const cashier = operatorId(seedAccounts.operator.name);
    expect(cashierOf(seedDevices.till.name)).toBe(cashier);

    // An unknown card on the USB reader: Nuovo cliente with the card.
    const uid = freshUid();
    await readOnUsbReader(page, uid, '/clienti/nuovo');
    await expect(page.getByRole('region', { name: 'Card letta' })).toContainText(`Codice ${uid}:`);
    const name = uniqueName('Tina Tablet E2E');
    await page.getByRole('textbox', { name: 'Nome e cognome' }).fill(name);
    await page.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ }).check();
    await page.getByRole('button', { name: 'Salva cliente' }).click();
    await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}\/spesa$/);
    const customerId = /\/clienti\/([0-9a-f-]{36})\/spesa$/.exec(page.url())?.[1];
    if (customerId === undefined) throw new Error('No customer id in the URL');
    // The customer was created by the cashier, not by the device.
    expect(
      runSql(`select created_by from app.customers where id = :'id';`, { id: customerId }),
    ).toBe(cashier);

    // Associa card: another new card on the USB reader is associated by the cashier; the USB
    // reader cannot write, so the link stays not written (SPEC-tablet-kiosk, point 8).
    const second = freshUid();
    await page.goto(`/clienti/${customerId}/card`);
    await expect(page.getByText('Passa la card nuova sul lettore')).toBeVisible();
    await expect(async () => {
      if (new URL(page.url()).pathname.endsWith('/card')) await passOnUsbReader(page, second);
      await expect(page).toHaveURL(`/clienti/${customerId}`, { timeout: 1000 });
    }).toPass({ timeout: 8000 });
    await expect(page.getByRole('status')).toContainText('Link non scritto');
    expect(
      runSql(
        `select active || '|' || associated_by || '|' || coalesce(link_written_at::text, 'none')
         from app.cards where uid = :'uid';`,
        { uid: second },
      ),
    ).toBe(`true|${cashier}|none`);
    // The reads below use the second card, the active one: only an admin may bring the first
    // one back from Associa card (SPEC-customers-v2.md, criterion 11).

    // The active card, read from the home with the fake reader: Registra spesa.
    await page.goto('/');
    await page.waitForTimeout(REPEAT_WINDOW_MS);
    await expect(async () => {
      if (new URL(page.url()).pathname === '/') {
        await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(second));
      }
      await expect(page).toHaveURL(`/clienti/${customerId}/spesa`, { timeout: 1000 });
    }).toPass({ timeout: 8000 });

    // And on the USB reader, timed from the read to the confirmation (criterion 6).
    await page.goto('/');
    await expect(chip).toBeVisible();
    await page.waitForTimeout(REPEAT_WINDOW_MS);
    const started = Date.now();
    await readOnUsbReader(page, second, `/clienti/${customerId}/spesa`);
    await typeAmount(page, '1250');
    await page.getByRole('button', { name: 'Conferma +12' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeVisible();
    expect(Date.now() - started, 'from the card to «Spesa registrata»').toBeLessThan(10_000);
    await expect(
      page.getByText(
        new RegExp(`^12,50\\s€ · oggi \\d{2}:\\d{2} · ${seedAccounts.operator.name}$`),
      ),
    ).toBeVisible();

    // The movement holds the cashier as its operator (criterion 2).
    expect(
      runSql(
        `select kind || '|' || amount_cents || '|' || points || '|' || operator_id
         from app.movements where customer_id = :'id';`,
        { id: customerId },
      ),
    ).toBe(`purchase|1250|12|${cashier}`);

    // "Cambia": the turn ends on the server and the tablet asks who is at the till.
    await page.goto('/');
    await chip.click();
    await expect(page).toHaveURL(/\/cassa$/);
    await expect(page.getByRole('heading', { name: 'Chi è alla cassa?' })).toBeVisible();
    expect(cashierOf(seedDevices.till.name)).toBe('');
    await page.goto('/');
    await expect(page).toHaveURL(/\/cassa$/);
  });
});

test('5 wrong PINs lock the till, even after a reload; the 6th, right, is refused (criterion 3)', async ({
  page,
  request,
}) => {
  // A tablet of its own, without a lock left by an earlier run.
  resetDevice(seedDevices.lockedTill.name);
  await signInDevice(page, seedDevices.lockedTill.email);
  await operatorButton(page, seedAccounts.operator.name).click();
  const panel = page.getByRole('complementary', { name: 'PIN' });

  // One wrong PIN after the other: each waits for the server's answer to the previous one.
  await [4, 3, 2, 1].reduce(
    (previous, attemptsLeft) =>
      previous.then(async () => {
        await tapPin(page, '0000');
        await expect(panel.getByRole('alert')).toHaveText(
          `PIN errato. Tentativi rimasti: ${attemptsLeft}`,
        );
      }),
    Promise.resolve(),
  );
  await tapPin(page, '0000');
  const timer = panel.getByRole('timer');
  await expect(timer).toHaveText(/^Troppi tentativi: riprova tra [45]:\d{2}$/);
  await expectKeypadOff(page);

  // The lock is on the server: a reload does not lift it.
  await page.reload();
  await expect(page).toHaveURL(/\/cassa$/);
  await operatorButton(page, seedAccounts.operator.name).click();
  await expect(panel.getByRole('timer')).toHaveText(/^Troppi tentativi: riprova tra [45]:\d{2}$/);
  await expectKeypadOff(page);

  // The keypad is off, so the 6th attempt goes straight to the server: the right PIN is refused.
  const { key, token } = await signedInApi(request, seedDevices.lockedTill.email);
  const answer = await request.post(`${LOCAL_SUPABASE_URL}/rest/v1/rpc/unlock_cashier`, {
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Profile': 'app' },
    data: { p_operator_id: operatorId(seedAccounts.operator.name), p_pin: SEED_PINS.operator },
  });
  expect(answer.ok()).toBe(true);
  expect(await answer.json()).toMatchObject({ status: 'locked' });
  expect(cashierOf(seedDevices.lockedTill.name)).toBe('');
  await expect(page).toHaveURL(/\/cassa$/);
});
