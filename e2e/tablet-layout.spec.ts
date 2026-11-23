import type { Locator, Page } from '@playwright/test';
import { SEED_PINS, seedAccounts, seedDevices, signInDevice } from './auth';
import { expect, homeCustomers, test } from './fixtures';
import { uniqueName } from './nfc';
import { operatorButton, resetDevice, tapPin } from './tablet';

/**
 * The screens of the till tablet at 1280×800 (docs/specs/SPEC-tablet-kiosk.md, point 10 and
 * criterion 7), measured in a real browser: jsdom applies no CSS. On every screen of the tablet
 * wireframes: no horizontal scroll, every touch target at least 48 px, the main action at least
 * 70 px above the bottom edge (Android's bars, note nt1); and the columns of point 10 where the
 * screen has them. A tablet of its own (`layoutTill`), with the seed admin at the till, so the
 * admin screens are there too.
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
    // CLIENTI in two columns on the right (SPEC-customers-v2 point 6): the first two rows side by side.
    const rows = homeCustomers(page).getByRole('link');
    await expect(rows.nth(1)).toBeVisible();
    const first = await rows.nth(0).boundingBox();
    const second = await rows.nth(1).boundingBox();
    if (!first || !second) throw new Error('The CLIENTI rows have no box');
    expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(TOLERANCE);
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
    expect(first.x).toBeGreaterThanOrEqual(440);
    await expectTabletScreen(page, page.getByRole('link', { name: 'Nuovo cliente' }));
  });

  const name = uniqueName('Lia Layout E2E');
  await test.step('Nuovo cliente', async () => {
    await page.getByRole('link', { name: 'Nuovo cliente' }).click();
    await expect(page.getByRole('region', { name: 'Card' })).toBeVisible();
    const save = page.getByRole('button', { name: 'Salva cliente' });
    await expectColumn(page.locator('[data-tablet-column="card"]'), 440, 'right');
    await expectTabletScreen(page, save);
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
    await expectColumn(page.getByRole('complementary', { name: 'Tastierino' }), 480, 'right');
    await expectTabletScreen(page, confirm);
    await confirm.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeVisible();
    // One 480 px column in the middle, without header.
    const way = page.getByRole('link', { name: 'Leggi un’altra card' });
    const wayBox = await way.boundingBox();
    if (!wayBox) throw new Error('No box on Spesa registrata');
    expect(Math.abs(wayBox.width - 480)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(wayBox.x + wayBox.width / 2 - 640)).toBeLessThanOrEqual(TOLERANCE);
    await expectTabletScreen(page, way);
  });

  await test.step('Riscatta premio and Premio libero', async () => {
    await page.goto(`${customerPath}/premi`);
    await expect(page.getByRole('heading', { level: 1, name: 'Riscatta premio' })).toBeVisible();
    const summary = page.getByRole('complementary', { name: 'Riepilogo' });
    await expectColumn(summary, 400, 'right');
    await expectTabletScreen(page, summary.getByRole('button', { name: /^Riscatta/ }));
    await page.getByRole('link', { name: /Premio libero/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Premio libero' })).toBeVisible();
    const keypad = page.getByRole('complementary', { name: 'Tastierino' });
    await expectColumn(keypad, 480, 'right');
    await expectTabletScreen(page, keypad.getByRole('button', { name: /^Riscatta/ }));
  });

  await test.step('Associa card', async () => {
    await page.goto(`${customerPath}/card`);
    await expect(page.getByText('Passa la card nuova sul lettore')).toBeVisible();
    const wide = page.locator('[data-tablet-column="associate"]');
    const box = await wide.boundingBox();
    if (!box) throw new Error('No Associa card column');
    expect(Math.abs(box.width - 560)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(TOLERANCE);
    await expectTabletScreen(page, wide.getByRole('link', { name: 'Annulla' }));
  });

  await test.step('Movimenti', async () => {
    await page.goto(`${customerPath}/movimenti`);
    await expect(page.getByTestId('movements-column')).toBeVisible();
    await expectTabletScreen(page, null);
  });

  await test.step('Catalogo premi', async () => {
    await page.goto('/impostazioni/premi');
    await expect(page.getByRole('heading', { level: 1, name: /Catalogo premi/ })).toBeVisible();
    const newReward = page.locator('[data-tablet-column="new-reward"]');
    await expectColumn(newReward, 480, 'right');
    await expectTabletScreen(page, newReward.getByRole('button', { name: 'Aggiungi premio' }));
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
  // Measured once the customer has loaded: the header re-renders when it arrives, and a chip
  // measured before that can be detached between `toBeVisible` and `boundingBox`.
  await expect(page.getByRole('heading', { level: 1, name: 'Giulia Bianchi' })).toBeVisible();
  await expectHeaderFits(page.getByRole('link', { name: /Modifica/ }));

  resetDevice(till.name);
});
