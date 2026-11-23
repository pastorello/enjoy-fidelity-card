import { randomBytes } from 'node:crypto';
import { devices, type Browser, type Page, type TestInfo } from '@playwright/test';
import { seedDevices, signIn, signInDevice } from './auth';
import { runSql } from './db';
import { expect, test } from './fixtures';
import { messagesTo, waitForMessageTo } from './mailpit';
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
 * failure. From the tablet an admin is invited, named or reactivated only with the cashier's PIN
 * typed again (Open Questions 11): its wrong PINs count with those of /cassa.
 */

// One tablet, one cashier on the server: these tests take turns on it.
test.describe.configure({ mode: 'serial' });

const TILL = seedDevices.operatorsTill;
const ADMIN = { email: 'admin-operatori@example.com', name: 'Admin Operatori', pin: '9753' };
const SHIFT = { name: 'Turno Prova', pin: '8642' } as const;
const NO_PIN = { name: 'Nuovo Prova' } as const;
const TURN_ENDED = 'Turno scaduto: inserisci di nuovo il PIN';
const PIN_TITLE = 'Conferma con il PIN';

/** Wrong PINs counted on the till and whether it is locked, as `n|locked`. */
function tillAttempts(): string {
  return runSql(
    `select failed_pin_attempts || '|' || (locked_until is not null) from app.devices
     where name = :'name';`,
    { name: TILL.name },
  );
}

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

test('the tablet with an admin at the till: list, 480 px column, PIN states, (tu), admins with the PIN (criterion 10)', async ({
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

  // An administrator can be chosen in the invite form; the note of the button names the PIN.
  await expect(invite.getByRole('radio', { name: 'Amministratore' })).toBeEnabled();
  await expect(invite.getByRole('radio', { name: 'Operatore' })).toBeChecked();
  await expect(
    invite.getByText(
      'Riceverà un’email per scegliere la password; il PIN per il tablet lo imposta dal proprio telefono.',
    ),
  ).toBeVisible();
});

/** The device signed in, the admin at the till, on the Operators screen. */
async function openOperatorsAtTill(page: Page) {
  await signInDevice(page, TILL.email);
  await unlock(page, ADMIN.name, ADMIN.pin);
  await page.goto('/impostazioni/operatori');
  await expect(page.getByRole('heading', { level: 1, name: 'Operatori' })).toBeVisible();
}

test('from the tablet an admin is named only with the PIN of the cashier: a wrong one is counted, the right one names them (criterion 10)', async ({
  page,
}) => {
  await openOperatorsAtTill(page);
  await row(page, NO_PIN.name)
    .getByRole('button', { name: new RegExp(`^${NO_PIN.name}`) })
    .click();
  const dialog = page.getByRole('dialog', { name: NO_PIN.name });
  await dialog.getByRole('radio', { name: 'Amministratore' }).check();
  await dialog.getByRole('button', { name: 'Salva ruolo' }).click();
  await dialog.getByRole('button', { name: 'Rendi amministratore' }).click();
  await expect(
    dialog.getByText(`Per rendere ${NO_PIN.name} amministratore dal tablet serve il tuo PIN.`),
  ).toBeVisible();
  await expect(dialog.getByRole('heading', { name: `PIN di ${ADMIN.name}` })).toBeVisible();
  await expectTouchTargets(page);

  await tapPin(page, '0000');
  await expect(dialog.getByRole('alert')).toHaveText('PIN errato. Tentativi rimasti: 4');
  expect(tillAttempts()).toBe('1|false');
  expect(
    runSql(`select role from app.operators where name = :'name';`, { name: NO_PIN.name }),
  ).toBe('operator');

  await tapPin(page, ADMIN.pin);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`${NO_PIN.name} è ora amministratore.`)).toBeVisible();
  await expect(row(page, NO_PIN.name)).toContainText('Amministratore · attivo');
  expect(tillAttempts()).toBe('0|false');
});

test('from the tablet an admin is invited with the PIN of the cashier: one email, the PIN nowhere (criterion 10)', async ({
  page,
}) => {
  const suffix = randomBytes(4).toString('hex');
  const name = `Invito Tablet ${suffix}`;
  const email = `invito-tablet-${suffix}@example.com`;
  await openOperatorsAtTill(page);
  const invite = page.getByRole('complementary', { name: 'Invita operatore' });
  await invite.getByLabel('Nome').fill(name);
  await invite.getByLabel('Email').fill(email);
  await invite.getByRole('radio', { name: 'Amministratore' }).check();
  const since = new Date();
  await invite.getByRole('button', { name: 'Invia invito' }).click();

  const pin = page.getByRole('dialog', { name: PIN_TITLE });
  await expect(
    pin.getByText(`Per invitare ${name} come amministratore dal tablet serve il tuo PIN.`),
  ).toBeVisible();
  // The PIN step fits the tablet: its keys and "Annulla" are on screen without scrolling.
  await expect(pin.getByRole('button', { name: 'Annulla' })).toBeInViewport();
  await expect(pin.getByRole('button', { name: '0', exact: true })).toBeInViewport();
  await tapPin(page, ADMIN.pin);
  await expect(pin).toHaveCount(0);
  await expect(page.getByText(`Invito inviato a ${name}.`)).toBeVisible();
  await expect(row(page, name)).toContainText('Amministratore · invito inviato');

  const message = await waitForMessageTo(email, since);
  expect(message.subject).toBe('Enjoy Card: il tuo invito');
  expect(message.html).toContain('amministratore');
  expect(message.html).not.toContain(ADMIN.pin);
  expect(await messagesTo(email, since)).toHaveLength(1);
  expect(
    runSql(
      `select count(*) from private.operator_invites i
       where lower(i.email) = lower(:'email') and to_jsonb(i)::text like '%' || :'pin' || '%';`,
      { email, pin: ADMIN.pin },
    ),
  ).toBe('0');
});

test.describe('wrong PINs of an invite', () => {
  // The function answers a wrong PIN with 403 (wrong_pin, pin_locked): the browser logs it.
  test.use({ expectedRefusals: [/\/functions\/v1\/operator-invites$/] });

  test('five wrong PINs on an admin action lock the till, /cassa too, counted down (criterion 10)', async ({
    page,
  }) => {
    await openOperatorsAtTill(page);
    const invite = page.getByRole('complementary', { name: 'Invita operatore' });
    await invite.getByLabel('Nome').fill('Blocco Tablet');
    await invite.getByLabel('Email').fill('blocco-tablet@example.com');
    await invite.getByRole('radio', { name: 'Amministratore' }).check();
    await invite.getByRole('button', { name: 'Invia invito' }).click();
    const pin = page.getByRole('dialog', { name: PIN_TITLE });
    const alert = pin.getByRole('alert');
    // One wrong PIN after the other: each answer counts the ones before it.
    await [4, 3, 2, 1].reduce(
      (previous, left) =>
        previous.then(async () => {
          await tapPin(page, '0000');
          await expect(alert).toHaveText(`PIN errato. Tentativi rimasti: ${left}`);
        }),
      Promise.resolve(),
    );
    await tapPin(page, '0000');
    await expect(pin.getByRole('timer')).toHaveText(/^Troppi tentativi: riprova tra [45]:\d\d$/);
    await expect(pin.getByRole('button', { name: '0', exact: true })).toBeDisabled();
    expect(tillAttempts()).toBe('0|true');

    // The step opened again still shows the lock, without a new try: the identity read it.
    await pin.getByRole('button', { name: 'Annulla' }).click();
    await expect(pin).toBeHidden();
    await invite.getByRole('button', { name: 'Invia invito' }).click();
    await expect(pin.getByRole('timer')).toHaveText(/^Troppi tentativi: riprova tra [45]:\d\d$/);
    await expect(pin.getByRole('button', { name: '0', exact: true })).toBeDisabled();

    // The same lock on the till: "Cambia" opens /cassa, which counts it down as well.
    await pin.getByRole('button', { name: 'Annulla' }).click();
    await page.getByRole('link', { name: `Alla cassa: ${ADMIN.name} · Cambia` }).click();
    await expect(page).toHaveURL('/cassa');
    await expect(page.getByRole('timer')).toHaveText(/^Troppi tentativi: riprova tra [45]:\d\d$/);
  });
});

test('from the tablet a deactivated admin comes back only with the PIN of the cashier (criterion 10)', async ({
  page,
}) => {
  runSql(
    `update app.operators set role = 'admin', deactivated_at = now(),
       deactivated_by = (select id from app.operators where name = :'admin')
     where name = :'name';`,
    { admin: ADMIN.name, name: SHIFT.name },
  );
  await openOperatorsAtTill(page);
  const target = row(page, SHIFT.name);
  await target.getByRole('button', { name: 'Riattiva', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: `Riattivare ${SHIFT.name}?` });
  await confirm.getByRole('button', { name: 'Riattiva', exact: true }).click();
  const pin = page.getByRole('dialog', { name: PIN_TITLE });
  await expect(
    pin.getByText(`Per riattivare ${SHIFT.name}, amministratore, dal tablet serve il tuo PIN.`),
  ).toBeVisible();
  await tapPin(page, ADMIN.pin);
  await expect(pin).toHaveCount(0);
  await expect(page.getByText(`${SHIFT.name} è di nuovo attivo.`)).toBeVisible();
  await expect(target).toContainText('Amministratore · attivo');
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
