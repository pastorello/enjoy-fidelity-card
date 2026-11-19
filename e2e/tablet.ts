import { expect, type Page } from '@playwright/test';
import { runSql } from './db';

/**
 * Helpers of the till tablet E2E (docs/specs/SPEC-tablet-kiosk.md): the USB reader as a keyboard
 * wedge, the PIN pad of /cassa, and what the server holds for a device. Shared by the specs of the
 * `tablet` and `tablet-settings` projects.
 */

/** The reader ignores the same uid for this long after a read (card-input, REPEAT_WINDOW_MS). */
export const REPEAT_WINDOW_MS = 2500;

/** A card on the USB reader: the uid as a fast burst of keys closed by Enter. */
export async function passOnUsbReader(page: Page, uid: string) {
  await page.keyboard.type(uid, { delay: 0 });
  await page.keyboard.press('Enter');
}

/**
 * A card on the USB reader from a screen that reads cards, until the app goes to `next`. The reader
 * turns on once the settings (the USB format) are loaded, which no text shows yet: a burst sent
 * before is not a read, and is passed again. A second burst of a card already read is harmless:
 * the reader ignores the same uid within REPEAT_WINDOW_MS.
 */
export async function readOnUsbReader(page: Page, uid: string, next: string) {
  await expect(async () => {
    if (new URL(page.url()).pathname === '/') await passOnUsbReader(page, uid);
    await expect(page).toHaveURL(next, { timeout: 1000 });
  }).toPass({ timeout: 8000 });
}

/** Taps a PIN on a "Tastierino PIN" (/cassa or /impostazioni/pin), one key after the other. */
export async function tapPin(page: Page, pin: string) {
  const keypad = page.getByRole('group', { name: 'Tastierino PIN' });
  await pin
    .split('')
    .reduce(
      (typed, digit) =>
        typed.then(() => keypad.getByRole('button', { name: digit, exact: true }).click()),
      Promise.resolve(),
    );
}

/** An operator's button in "Chi è alla cassa?". */
export function operatorButton(page: Page, name: string) {
  return page.getByRole('group', { name: 'Operatori' }).getByRole('button', { name });
}

/** The link "Alla cassa: <name> · Cambia" in the header of the tablet. */
export function cashierChip(page: Page, name: string) {
  return page.getByRole('link', { name: `Alla cassa: ${name} · Cambia` });
}

/** The id of a seed operator, by name. */
export function operatorId(name: string): string {
  return runSql(`select id from app.operators where name = :'name';`, { name });
}

/** Who the server holds as the cashier of a device (empty: none). */
export function cashierOf(device: string): string {
  return runSql(
    `select coalesce(cashier_operator_id::text, '') from app.devices where name = :'name';`,
    { name: device },
  );
}

/** A device as after `db:reset`: no cashier, no failed PIN, no lock. */
export function resetDevice(device: string) {
  runSql(
    `update app.devices set failed_pin_attempts = 0, locked_until = null,
       cashier_operator_id = null, cashier_since = null
     where name = :'name';`,
    { name: device },
  );
}
