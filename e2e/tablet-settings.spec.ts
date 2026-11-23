import type { Page } from '@playwright/test';
import { SEED_PINS, seedAccounts, seedDevices, signInDevice } from './auth';
import { runSql } from './db';
import { expect, test } from './fixtures';
import { uniqueName, freshUid } from './nfc';
import {
  REPEAT_WINDOW_MS,
  cashierChip,
  cashierOf,
  operatorButton,
  passOnUsbReader,
  readOnUsbReader,
  resetDevice,
  tapPin,
} from './tablet';

/**
 * The format of the USB reader, chosen on the till tablet (docs/specs/SPEC-tablet-kiosk.md, point
 * 9). It lives in the one shared settings row, so this file runs in the serial `tablet-settings`
 * project, after every other project, and `afterAll` puts back `hex` and the row's `updated_at` /
 * `updated_by` even after a failure, so the row is exactly as after `db:reset`.
 */
test.describe.configure({ mode: 'serial' });

const admin = seedAccounts.admin;
const tablet = seedDevices.till;

/** The settings row as stored, read as the database owner (local stack only). */
function storedRow(): string {
  return runSql(
    `select cents_per_point || '/' || confirm_threshold_cents || '/' || usb_uid_format
     from app.settings;`,
  );
}

/** A uid as a decimal reader types it: the same bytes read as one big-endian number. */
function asDecimal(uid: string): string {
  return BigInt(`0x${uid}`).toString(10);
}

/** LETTORE CARD in Impostazioni: picks a format and saves it. */
async function saveUsbFormat(page: Page, label: string) {
  await page.getByRole('link', { name: `Account e impostazioni: ${admin.name}` }).click();
  await expect(page).toHaveURL(/\/impostazioni$/);
  const section = page.getByRole('region', { name: 'LETTORE CARD' });
  await section.getByRole('radio', { name: label, exact: true }).check();
  await section.getByRole('button', { name: 'Salva' }).click();
  await expect(section.getByText('Formato salvato.')).toBeVisible();
  await expect(section.getByRole('radio', { name: label, exact: true })).toBeChecked();
}

/** `updated_at` and `updated_by` before this file, as text ('' for null). */
let stamp: { at: string; by: string } | undefined;

test.beforeAll(() => {
  const initial = storedRow();
  if (initial !== '100/15000/hex') {
    throw new Error(`Expected the initial settings, found ${initial}: run \`npm run db:reset\`.`);
  }
  const [at = '', by = ''] = runSql(
    `select updated_at::text || '|' || coalesce(updated_by::text, '') from app.settings;`,
  ).split('|');
  stamp = { at, by };
  resetDevice(tablet.name);
});

test.afterAll(() => {
  // Even after a failure: the initial format, as stamped before, and a free tablet.
  if (stamp) {
    runSql(
      `update app.settings
       set usb_uid_format = 'hex', updated_at = :'at'::timestamptz,
           updated_by = nullif(:'by', '')::uuid;`,
      stamp,
    );
  }
  resetDevice(tablet.name);
  expect(storedRow()).toBe('100/15000/hex');
});

test('an administrator at the till switches the reader to Decimale, a decimal read finds the card, then puts Esadecimale back', async ({
  page,
}) => {
  await signInDevice(page, tablet.email);
  await operatorButton(page, admin.name).click();
  await tapPin(page, SEED_PINS.admin);
  await expect(page).toHaveURL(/\/$/);
  await expect(cashierChip(page, admin.name)).toBeVisible();

  // A customer with a card, read in the initial format (hex).
  const uid = freshUid();
  await readOnUsbReader(page, uid, '/clienti/nuovo');
  await expect(page.getByRole('region', { name: 'Card letta' })).toContainText(`Codice ${uid}:`);
  await page.getByRole('textbox', { name: 'Nome e cognome' }).fill(uniqueName('Dora Decimale E2E'));
  await page.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ }).check();
  await page.getByRole('button', { name: 'Salva cliente' }).click();
  await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}\/spesa$/);
  const customerId = /\/clienti\/([0-9a-f-]{36})\/spesa$/.exec(page.url())?.[1];
  if (customerId === undefined) throw new Error('No customer id in the URL');

  // "Decimale": the same card, typed by the reader as a decimal number, opens Registra spesa.
  await page.goto('/');
  await saveUsbFormat(page, 'Decimale');
  expect(storedRow()).toBe('100/15000/dec');
  await page.goto('/');
  await page.waitForTimeout(REPEAT_WINDOW_MS);
  await readOnUsbReader(page, asDecimal(uid), `/clienti/${customerId}/spesa`);

  // In decimal the hex code is not a card: the home stays put.
  await page.goto('/');
  await expect(cashierChip(page, admin.name)).toBeVisible();
  await page.waitForTimeout(REPEAT_WINDOW_MS);
  await passOnUsbReader(page, `${uid.slice(0, -2)}AB`);
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/$/);

  // Back to "Esadecimale": the hex code finds the card again.
  await saveUsbFormat(page, 'Esadecimale');
  expect(storedRow()).toBe('100/15000/hex');
  await page.goto('/');
  await page.waitForTimeout(REPEAT_WINDOW_MS);
  await readOnUsbReader(page, uid, `/clienti/${customerId}/spesa`);

  // "Cambia" leaves the tablet free for the next run.
  await page.goto('/');
  await cashierChip(page, admin.name).click();
  await expect(page).toHaveURL(/\/cassa$/);
  expect(cashierOf(tablet.name)).toBe('');
});
