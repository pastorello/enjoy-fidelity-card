import type { Locator, Page } from '@playwright/test';
import { SEED_PINS, seedAccounts, seedDevices, signInDevice } from './auth';
import { expect, test } from './fixtures';
import { uniqueName } from './nfc';
import {
  expectColumn,
  expectNoHorizontalScroll,
  expectTouchTargets,
  operatorButton,
  resetDevice,
  tapPin,
  TOLERANCE,
} from './tablet';

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
  // Measured once the new page is drawn: the URL changes first, and until React commits the
  // navigation the chip found is the one of the home page, which is then removed.
  await expect(page.getByRole('heading', { level: 1, name: 'Giulia Bianchi' })).toBeVisible();
  await expectHeaderFits(page.getByRole('link', { name: /Modifica/ }));

  resetDevice(till.name);
});
