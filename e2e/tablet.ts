import { expect, type Locator, type Page } from '@playwright/test';
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

/** Pixels of rounding allowed on a measured width (layout E2E). */
export const TOLERANCE = 1;

/** The page never scrolls sideways. */
export async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'document scroll width').toBeLessThanOrEqual(clientWidth);
}

/**
 * Every visible control is at least 48 px tall. Links inside a sentence are exempt (WCAG 2.5.8,
 * "inline"), and so are the native inputs a styled control hides (their label is the target).
 */
export async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() => {
    const controls = document.querySelectorAll<HTMLElement>(
      'button, a[href], [role="radio"], [role="checkbox"], input, select, textarea',
    );
    return [...controls].flatMap((control) => {
      // A native radio or checkbox is tapped through its label, which is the target.
      const target =
        control instanceof HTMLInputElement && ['radio', 'checkbox'].includes(control.type)
          ? (control.closest('label') ?? control)
          : control;
      const box = target.getBoundingClientRect();
      const style = getComputedStyle(control);
      const hidden =
        box.width === 0 ||
        box.height === 0 ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        control.closest('.visually-hidden') !== null;
      const inline = control.tagName === 'A' && control.closest('p') !== null;
      if (hidden || inline || box.height >= 48) return [];
      const label =
        control.getAttribute('aria-label') ??
        (target.textContent?.trim() || control.getAttribute('name')) ??
        '';
      return [`${control.tagName.toLowerCase()} "${label}" ${Math.round(box.height)} px`];
    });
  });
  expect(small, `controls under 48 px on ${page.url()}`).toEqual([]);
}

/** A column `width` px wide (±1), against the left or the right edge of the page. */
export async function expectColumn(column: Locator, width: number, side: 'left' | 'right') {
  const box = await column.boundingBox();
  if (!box) throw new Error('The column has no box');
  expect(Math.abs(box.width - width), `column width ${box.width}`).toBeLessThanOrEqual(TOLERANCE);
  if (side === 'left') expect(box.x + box.width).toBeLessThanOrEqual(1280 / 2);
  else expect(box.x).toBeGreaterThanOrEqual(1280 / 2);
}
