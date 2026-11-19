import type { Locator, Page } from '@playwright/test';
import { SEED_PINS, seedAccounts, seedDevices, signInDevice } from './auth';
import { expect, test } from './fixtures';
import { uniqueName } from './nfc';
import { operatorButton, resetDevice, tapPin } from './tablet';

/**
 * The screens of the till tablet at 1280×800 (docs/specs/SPEC-tablet-kiosk.md, point 10 and
 * criterion 7), measured in a real browser: jsdom applies no CSS. On every screen of the tablet
 * wireframes: no horizontal scroll, every touch target at least 48 px, the main action at least
 * 70 px above the bottom edge (Android's bars, note nt1); and the columns of point 10 where the
 * screen has them. A tablet of its own (`layoutTill`), with the seed admin at the till, so the
 * admin screens are there too.
 *
 * Nuovo cliente (Card panel 440 px), Registra spesa and Premio libero (keypad 480 px), Riscatta
 * premio (summary 400 px) and Catalogo premi (480 px) still have the phone's one-column layout with
 * the actions in the footer: their tablet layouts are tasks 23 and 24 of tasks/tablet-kiosk, still
 * open. Until then this spec checks only what holds for them already (no horizontal scroll, 48 px
 * targets); their columns and the bottom clearance of their actions come with those tasks.
 */

// One tablet, one cashier on the server: these tests take turns on it.
test.describe.configure({ mode: 'serial' });

const VIEWPORT_HEIGHT = 800;
/** Android's system bars take 50–70 points off the bottom (wireframe note nt1). */
const BOTTOM_CLEARANCE = 70;
const TOLERANCE = 1;

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

/** The page never scrolls sideways. */
async function expectNoHorizontalScroll(page: Page) {
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
async function expectTouchTargets(page: Page) {
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

/** The main action ends at least 70 px above the bottom edge. */
async function expectAwayFromBottom(page: Page, action: Locator) {
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  if (!box) throw new Error('The main action has no box');
  expect(box.y + box.height, `bottom of the main action on ${page.url()}`).toBeLessThanOrEqual(
    VIEWPORT_HEIGHT - BOTTOM_CLEARANCE,
  );
}

/** What every screen of the tablet must hold. */
async function expectTabletScreen(page: Page, mainAction: Locator | null) {
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  if (mainAction) await expectAwayFromBottom(page, mainAction);
}

/** A column `width` px wide (±1), against the left or the right edge of the page. */
async function expectColumn(column: Locator, width: number, side: 'left' | 'right') {
  const box = await column.boundingBox();
  if (!box) throw new Error('The column has no box');
  expect(Math.abs(box.width - width), `column width ${box.width}`).toBeLessThanOrEqual(TOLERANCE);
  if (side === 'left') expect(box.x + box.width).toBeLessThanOrEqual(1280 / 2);
  else expect(box.x).toBeGreaterThanOrEqual(1280 / 2);
}

test('every screen of the tablet wireframes at 1280×800 (criterion 7)', async ({ page }) => {
  const till = seedDevices.layoutTill;
  resetDevice(till.name);
  await signInDevice(page, till.email);

  await test.step('/cassa: the PIN panel on the right, 480 px', async () => {
    await operatorButton(page, seedAccounts.admin.name).click();
    const panel = page.getByRole('complementary', { name: 'PIN' });
    await expectColumn(panel, 480, 'right');
    await expectTabletScreen(page, panel.getByRole('button', { name: 'Cancella ultima cifra' }));
    await tapPin(page, SEED_PINS.admin);
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step('Cerca: the reader column on the left, 440 px', async () => {
    const reader = page.locator('[data-tablet="true"] > :first-child');
    await expect(reader.getByRole('region', { name: 'Lettura card' })).toBeVisible();
    await expectColumn(reader, 440, 'left');
    await expectTabletScreen(page, page.getByRole('link', { name: 'Nuovo cliente' }));
  });

  const name = uniqueName('Lia Layout E2E');
  await test.step('Nuovo cliente', async () => {
    await page.getByRole('link', { name: 'Nuovo cliente' }).click();
    await expect(page.getByRole('region', { name: 'Card' })).toBeVisible();
    const save = page.getByRole('button', { name: 'Salva cliente' });
    // Task 24: the Card panel (440 px) and "Salva cliente" away from the bottom edge.
    await expectTabletScreen(page, null);
    await page.getByRole('textbox', { name: 'Nome e cognome' }).fill(name);
    await page.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ }).check();
    await save.click();
    await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}$/);
  });
  const customerPath = new URL(page.url()).pathname;

  await test.step('Scheda cliente: balance and actions on the left, 560 px', async () => {
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expectColumn(page.locator('[data-tablet-column="customer"]'), 560, 'left');
    await expectTabletScreen(page, page.getByRole('link', { name: 'Registra spesa' }));
  });

  await test.step('Registra spesa, then Spesa registrata', async () => {
    await page.getByRole('link', { name: 'Registra spesa' }).click();
    await expect(page.getByRole('group', { name: 'Tastierino numerico' })).toBeVisible();
    await typeAmount(page, '2500');
    const confirm = page.getByRole('button', { name: /^Conferma/ });
    // Task 23: the keypad column (480 px) and "Conferma" away from the bottom edge.
    await expectTabletScreen(page, null);
    await confirm.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeVisible();
    await expectTabletScreen(page, null);
  });

  await test.step('Riscatta premio and Premio libero', async () => {
    await page.goto(`${customerPath}/premi`);
    await expect(page.getByRole('heading', { level: 1, name: 'Riscatta premio' })).toBeVisible();
    await expectTabletScreen(page, null);
    await page.getByRole('link', { name: /Premio libero/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Premio libero' })).toBeVisible();
    // Task 23: the summary (400 px) of Riscatta premio and the keypad (480 px) of Premio libero.
    await expectTabletScreen(page, null);
  });

  await test.step('Associa card', async () => {
    await page.goto(`${customerPath}/card`);
    await expect(page.getByText('Passa la card nuova sul lettore')).toBeVisible();
    // Task 24: "Annulla" in the wide column, away from the bottom edge.
    await expectTabletScreen(page, null);
  });

  await test.step('Movimenti', async () => {
    await page.goto(`${customerPath}/movimenti`);
    await expect(page.getByTestId('movements-column')).toBeVisible();
    await expectTabletScreen(page, null);
  });

  await test.step('Catalogo premi', async () => {
    await page.goto('/impostazioni/premi');
    await expect(page.getByRole('heading', { level: 1, name: /Catalogo premi/ })).toBeVisible();
    // Task 24: the list and the 480 px "Nuovo premio" column.
    await expectTabletScreen(page, null);
  });

  await test.step('Impostazioni', async () => {
    await page.goto('/impostazioni');
    await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible();
    await expectTabletScreen(page, null);
  });

  resetDevice(till.name);
});

test('the cashier chip fits a narrow window of the till tablet (390 px wide)', async ({ page }) => {
  const till = seedDevices.layoutTill;
  await page.setViewportSize({ width: 390, height: 844 });
  resetDevice(till.name);
  await signInDevice(page, till.email);
  await operatorButton(page, seedAccounts.admin.name).click();
  await tapPin(page, SEED_PINS.admin);
  await expect(page).toHaveURL(/\/$/);

  const chip = page.getByRole('link', { name: `Alla cassa: ${seedAccounts.admin.name} · Cambia` });
  /** The chip and the header button beside it (`button`) stay inside the 390 px. */
  async function expectHeaderFits(button: Locator) {
    await expect(chip).toBeVisible();
    expect((await chip.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    const box = await button.boundingBox();
    if (!box) throw new Error('No header button');
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expectNoHorizontalScroll(page);
    // "Cambia" is never cut: it ends inside the chip.
    const change = chip.getByText('· Cambia');
    const [chipBox, changeBox] = await Promise.all([chip.boundingBox(), change.boundingBox()]);
    if (!chipBox || !changeBox) throw new Error('No chip box');
    expect(changeBox.x + changeBox.width).toBeLessThanOrEqual(chipBox.x + chipBox.width);
  }

  await expectHeaderFits(page.getByRole('link', { name: /^Account e impostazioni/ }));

  // Scheda cliente: back button, the customer's name, the chip and the edit button.
  await page.getByRole('searchbox').fill('Bianchi');
  await page.getByRole('link', { name: /Giulia Bianchi/ }).click();
  await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}$/);
  await expectHeaderFits(page.getByRole('link', { name: /Modifica/ }));
  await expect(page.getByRole('heading', { level: 1, name: 'Giulia Bianchi' })).toBeVisible();

  resetDevice(till.name);
});
