import { devices, type Browser, type Page, type TestInfo } from '@playwright/test';
import { seedAccounts, seedDevices, signIn, signInDevice } from './auth';
import { runSql } from './db';
import { expect, test } from './fixtures';
import { cashierChip, cashierOf, operatorButton, operatorId, resetDevice, tapPin } from './tablet';

/**
 * The till PIN set from one's own phone and used on the tablet (docs/specs/SPEC-tablet-kiosk.md,
 * point 7 and criterion 4). The `page` of the test is the tablet (1280×800, `tablet` project); a
 * second context is the operator's phone at 390×844. Only `pin@example.com` (Pin Prova, no PIN in
 * the seed) and the tablet `cassa-pin@example.com` are used, so the tests on the other tablets run
 * at the same time undisturbed.
 */

const operator = seedAccounts.pin;
const tablet = seedDevices.pinTill;
/** Fake PINs: the first one, then the one that replaces it. */
const FIRST_PIN = '4826';
const SECOND_PIN = '9173';

/** The phone of the operator, signed in with their own account. */
async function openPhone(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    baseURL: testInfo.project.use.baseURL,
  });
  const phone = await context.newPage();
  const errors: string[] = [];
  phone.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  phone.on('pageerror', (error) => errors.push(error.message));
  await signIn(phone, operator.email);
  return { context, phone, errors };
}

/** Impostazioni → ACCOUNT → "PIN della cassa" on the phone: chosen, repeated, saved. */
async function setPinFromPhone(
  operatorPhone: Page,
  pin: string,
  before: 'Da impostare' | 'Impostato',
) {
  await operatorPhone.goto('/impostazioni');
  const row = operatorPhone.getByRole('link', { name: /PIN della cassa/ });
  await expect(row).toContainText(before);
  await row.click();
  await expect(operatorPhone).toHaveURL(/\/impostazioni\/pin$/);
  await expect(operatorPhone.getByRole('heading', { name: 'Scegli il PIN' })).toBeVisible();
  await tapPin(operatorPhone, pin);
  await expect(operatorPhone.getByRole('heading', { name: 'Ripeti il PIN' })).toBeVisible();
  await tapPin(operatorPhone, pin);
  await expect(operatorPhone).toHaveURL(/\/impostazioni$/);
  await expect(operatorPhone.getByText('PIN salvato.')).toBeVisible();
  await expect(operatorPhone.getByRole('link', { name: /PIN della cassa/ })).toContainText(
    'Impostato',
  );
}

/** Pin Prova as in the seed (no PIN) and its tablet free, whatever an earlier run left. */
function resetState() {
  runSql(
    `delete from private.operator_pins
     where operator_id = (select id from app.operators where name = :'name');`,
    { name: operator.name },
  );
  resetDevice(tablet.name);
}

test.beforeAll(resetState);
test.afterAll(resetState);

test('a PIN set from the phone works at once on the tablet; a new PIN ends the open turn (criterion 4)', async ({
  page,
  browser,
}, testInfo) => {
  const { context, phone, errors } = await openPhone(browser, testInfo);
  try {
    // Without a PIN the operator cannot be chosen at the till.
    await signInDevice(page, tablet.email);
    await expect(operatorButton(page, operator.name)).toBeDisabled();

    await setPinFromPhone(phone, FIRST_PIN, 'Da impostare');

    // The tablet uses it at once: the list of /cassa is read again on the next visit.
    await page.reload();
    await expect(page).toHaveURL(/\/cassa$/);
    await operatorButton(page, operator.name).click();
    await tapPin(page, FIRST_PIN);
    await expect(page).toHaveURL(/\/$/);
    const chip = cashierChip(page, operator.name);
    await expect(chip).toBeVisible();
    expect(cashierOf(tablet.name)).toBe(operatorId(operator.name));

    // A second PIN from the phone ends the open turn on the server…
    await setPinFromPhone(phone, SECOND_PIN, 'Impostato');
    expect(cashierOf(tablet.name)).toBe('');

    // …and the tablet goes back to /cassa at the next change of route.
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('link', { name: `Account e impostazioni: ${operator.name}` }).click();
    await expect(page).toHaveURL(/\/cassa$/);
    await expect(page.getByText('Turno scaduto: inserisci di nuovo il PIN')).toBeVisible();

    // The old PIN no longer opens the till; the new one does.
    await operatorButton(page, operator.name).click();
    const panel = page.getByRole('complementary', { name: 'PIN' });
    await tapPin(page, FIRST_PIN);
    await expect(panel.getByRole('alert')).toHaveText('PIN errato. Tentativi rimasti: 4');
    await tapPin(page, SECOND_PIN);
    await expect(page).toHaveURL(/\/$/);
    await expect(chip).toBeVisible();
    expect(cashierOf(tablet.name)).toBe(operatorId(operator.name));

    // "Cambia" leaves the tablet free.
    await chip.click();
    await expect(page).toHaveURL(/\/cassa$/);
    expect(cashierOf(tablet.name)).toBe('');
    expect(errors, 'console errors on the phone').toEqual([]);
  } finally {
    await context.close();
  }
});
