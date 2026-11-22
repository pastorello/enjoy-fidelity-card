import { devices, type Browser, type Page, type TestInfo } from '@playwright/test';
import { seedDevices, signIn, signInDevice } from './auth';
import { runSql } from './db';
import { expect, test } from './fixtures';
import {
  expectColumn,
  expectNoHorizontalScroll,
  expectTouchTargets,
  operatorButton,
  resetDevice,
  tapPin,
} from './tablet';

/**
 * The Operators screen on the till tablet at 1280×800 (SPEC-operators, criteria 10 and 7), with
 * the device `cassa-operatori@example.com` and the seed people reserved to this file
 * (supabase/seed.sql): "Admin Operatori" (admin, PIN 9753) as the cashier, "Turno Prova"
 * (operator, PIN 8642), deactivated from a phone while at the till and reactivated, and "Nuovo
 * Prova" (operator, no PIN). e2e/operators.spec.ts signs in on phones with Admin Operatori at the
 * same time, but never changes it; every test here puts back what it changes, also after a
 * failure.
 */

// One tablet, one cashier on the server: these tests take turns on it.
test.describe.configure({ mode: 'serial' });

const TILL = seedDevices.operatorsTill;
const ADMIN = { email: 'admin-operatori@example.com', name: 'Admin Operatori', pin: '9753' };
const SHIFT = { name: 'Turno Prova', pin: '8642' } as const;
const NO_PIN = { name: 'Nuovo Prova' } as const;
const TURN_ENDED = 'Turno scaduto: inserisci di nuovo il PIN';

/** Turno Prova and Nuovo Prova back to the seed state (active operators). */
function restorePeople() {
  runSql(
    `update app.operators
     set role = 'operator', deactivated_at = null, deactivated_by = null
     where name in (:'shift', :'noPin') and (role <> 'operator' or deactivated_at is not null);`,
    { shift: SHIFT.name, noPin: NO_PIN.name },
  );
}

test.beforeEach(() => {
  restorePeople();
  resetDevice(TILL.name);
});

test.afterEach(() => {
  restorePeople();
  resetDevice(TILL.name);
});

/** The device signed in and `name` at the till with `pin`: the home page. */
async function unlock(page: Page, name: string, pin: string) {
  await operatorButton(page, name).click();
  await tapPin(page, pin);
  await expect(page).toHaveURL(/\/$/);
}

function list(page: Page) {
  return page.getByRole('list', { name: 'Operatori del bar' });
}

/** The row of `label` as the list shows the name ("Admin Operatori (tu)" for the cashier). */
function row(page: Page, label: string) {
  const exact = label.replace(/[()]/g, '\\$&');
  return list(page)
    .getByRole('listitem')
    .filter({ has: page.locator('[data-operator-name]', { hasText: new RegExp(`^${exact}$`) }) });
}

test('the tablet with an admin at the till: list, 480 px column, PIN states, (tu), no admin from here (criterion 10)', async ({
  page,
}) => {
  await signInDevice(page, TILL.email);
  await unlock(page, ADMIN.name, ADMIN.pin);

  // Impostazioni → GESTIONE: the tablet subtitle of the row, then the screen.
  await page.getByRole('link', { name: /^Account e impostazioni/ }).click();
  await expect(page).toHaveURL('/impostazioni');
  await page.getByRole('link', { name: /Account, ruoli, inviti e PIN/ }).click();
  await expect(page).toHaveURL('/impostazioni/operatori');
  await expect(page.getByRole('heading', { level: 1, name: 'Operatori' })).toBeVisible();

  // The list on the left, the invite form in the 480 px column on the right.
  const invite = page.getByRole('complementary', { name: 'Invita operatore' });
  await expectColumn(invite, 480, 'right');
  const listBox = await list(page).boundingBox();
  const inviteBox = await invite.boundingBox();
  if (!listBox || !inviteBox) throw new Error('No box for the list or the column');
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(inviteBox.x);

  // The cashier is "(tu)", with the PIN state and no action; the others show their PIN state.
  const me = row(page, `${ADMIN.name} (tu)`);
  await expect(me).toContainText('Amministratore · attivo · PIN impostato');
  await expect(me.getByRole('button')).toHaveCount(0);
  await expect(row(page, SHIFT.name)).toContainText('Operatore · attivo · PIN impostato');
  await expect(row(page, NO_PIN.name)).toContainText('Operatore · attivo · PIN da impostare');
  await expect(row(page, ADMIN.name)).toHaveCount(0);

  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);

  // An administrator is never invited from the tablet…
  await expect(invite.getByRole('radio', { name: 'Amministratore' })).toBeDisabled();
  await expect(invite.getByRole('radio', { name: 'Operatore' })).toBeChecked();
  await expect(invite.getByText('Un amministratore si invita dal telefono.')).toBeVisible();
  await expect(
    invite.getByText(
      'Riceverà un’email per scegliere la password; il PIN per il tablet lo imposta dal proprio telefono.',
    ),
  ).toBeVisible();

  // …nor promoted from it.
  await row(page, NO_PIN.name)
    .getByRole('button', { name: new RegExp(`^${NO_PIN.name}`) })
    .click();
  const dialog = page.getByRole('dialog', { name: NO_PIN.name });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Amministratore' })).toBeDisabled();
  await expect(dialog.getByText('Un amministratore si nomina dal telefono.')).toBeVisible();
  await expectTouchTargets(page);
  await dialog.getByRole('button', { name: 'Chiudi' }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    runSql(`select role from app.operators where name = :'name';`, { name: NO_PIN.name }),
  ).toBe('operator');
});

/** A phone (a new browser) with Admin Operatori on the Operators screen. */
async function openAdminPhone(browser: Browser, testInfo: TestInfo) {
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
  await signIn(phone, ADMIN.email);
  await phone.goto('/impostazioni/operatori');
  await expect(phone.getByRole('heading', { level: 1, name: 'Operatori' })).toBeVisible();
  return { context, phone, errors };
}

test('a cashier deactivated from the phone goes back to /cassa and leaves the list, then is reactivated (criterion 7)', async ({
  page,
  browser,
}, testInfo) => {
  await signInDevice(page, TILL.email);
  await unlock(page, SHIFT.name, SHIFT.pin);

  const { context, phone, errors } = await openAdminPhone(browser, testInfo);
  try {
    const target = row(phone, SHIFT.name);
    await target.getByRole('button', { name: 'Disattiva', exact: true }).click();
    const confirm = phone.getByRole('dialog', { name: `Disattivare ${SHIFT.name}?` });
    await confirm.getByRole('button', { name: 'Disattiva', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(target).toContainText('Operatore · disattivato, movimenti nello storico');

    // The next route of the tablet ends the turn: /cassa, with the message, without the cashier.
    await page.getByRole('link', { name: 'Nuovo cliente' }).click();
    await expect(page).toHaveURL('/cassa');
    await expect(page.getByText(TURN_ENDED)).toBeVisible();
    await expect(operatorButton(page, ADMIN.name)).toBeVisible();
    await expect(operatorButton(page, SHIFT.name)).toHaveCount(0);

    await target.getByRole('button', { name: 'Riattiva', exact: true }).click();
    const reactivate = phone.getByRole('dialog', { name: `Riattivare ${SHIFT.name}?` });
    await reactivate.getByRole('button', { name: 'Riattiva', exact: true }).click();
    await expect(reactivate).toHaveCount(0);
    await expect(target).toContainText('Operatore · attivo');
    expect(errors, 'console errors of the phone').toEqual([]);
  } finally {
    await context.close();
  }

  // Back in "Chi è alla cassa?", and the same PIN opens the till again.
  await page.reload();
  await unlock(page, SHIFT.name, SHIFT.pin);
  await expect(
    page.getByRole('link', { name: `Alla cassa: ${SHIFT.name} · Cambia` }),
  ).toBeVisible();
});
