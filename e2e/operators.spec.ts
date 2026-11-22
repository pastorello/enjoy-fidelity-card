import { randomBytes } from 'node:crypto';
import { devices, type Browser, type Page, type TestInfo } from '@playwright/test';
import { SEED_PASSWORD, signIn } from './auth';
import { runSql } from './db';
import { expect, test } from './fixtures';
import { linkHref, messagesTo, waitForMessageTo } from './mailpit';

/**
 * The Operators screen on the phone (SPEC-operators, criteria 1, 2, 6 and 7), with the invite
 * email read from Mailpit and the Edge Function `operator-invites` served locally
 * (`npx supabase functions serve`, as in CI). `fullyParallel` is on: the seed accounts below are
 * reserved to this file (supabase/seed.sql), each test changes only its own one and puts it back,
 * also after a failure; the invited people get a random name and email at every run.
 */

const ADMIN = { email: 'admin-operatori@example.com', name: 'Admin Operatori' } as const;
const ROLE = { email: 'ruolo@example.com', name: 'Ruolo Prova' } as const;
const DEACTIVATE = { email: 'disattiva@example.com', name: 'Disattiva Prova' } as const;

const INVITE_PREFIX = 'http://localhost:4173/imposta-password?token_hash=';
const NOT_ENABLED = 'Account non abilitato: chiedi a un amministratore.';

/** Role and deactivation of a reserved seed profile, as stored (local stack only). */
function storedState(name: string): string {
  return runSql(
    `select role || '/' || (deactivated_at is null)::text from app.operators where name = :'name';`,
    { name },
  );
}

/** Back to the seed state (an operator, active), whatever a failed test left. */
function restoreOperator(name: string) {
  runSql(
    `update app.operators
     set role = 'operator', deactivated_at = null, deactivated_by = null
     where name = :'name' and (role <> 'operator' or deactivated_at is not null);`,
    { name },
  );
}

test.beforeAll(() => {
  for (const { name } of [ROLE, DEACTIVATE]) {
    const state = storedState(name);
    if (state !== 'operator/true') {
      throw new Error(
        `Expected ${name} as an active operator, found ${state}: run \`npm run db:reset\`.`,
      );
    }
  }
});

/** Another phone (a new browser), whose console errors and warnings are collected. */
async function newPhone(browser: Browser, testInfo: TestInfo) {
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
  return { context, phone, errors };
}

/** A second phone signed in with `email`: the person whose account changes. */
async function openSecondPhone(browser: Browser, testInfo: TestInfo, email: string) {
  const second = await newPhone(browser, testInfo);
  await signIn(second.phone, email);
  return second;
}

/** Impostazioni → GESTIONE → Operatori, as the reserved administrator. */
async function openOperators(page: Page) {
  await signIn(page, ADMIN.email);
  await page.getByRole('link', { name: `Account e impostazioni: ${ADMIN.name}` }).click();
  await page.getByRole('link', { name: /Operatori/ }).click();
  await expect(page).toHaveURL('/impostazioni/operatori');
  await expect(page.getByRole('heading', { level: 1, name: 'Operatori' })).toBeVisible();
}

function list(page: Page) {
  return page.getByRole('list', { name: 'Operatori del bar' });
}

function row(page: Page, name: string) {
  return list(page)
    .getByRole('listitem')
    .filter({ has: page.locator('[data-operator-name]', { hasText: new RegExp(`^${name}$`) }) });
}

function messages(page: Page) {
  return page.locator('[data-operators-messages]');
}

/** The settings of the signed-in phone: GESTIONE (with Operatori) only for administrators. */
async function expectSettingsOf(phone: Page, role: 'admin' | 'operator') {
  await expect(phone).toHaveURL('/impostazioni');
  const account = phone.getByRole('region', { name: 'Account', exact: true });
  await expect(account).toContainText(role === 'admin' ? 'Amministratore' : 'Operatore');
  const management = phone.getByRole('heading', { name: 'GESTIONE' });
  const operatorsRow = phone.getByRole('link', { name: /Operatori/ });
  if (role === 'admin') {
    await expect(management).toBeVisible();
    await expect(operatorsRow).toBeVisible();
  } else {
    await expect(management).toHaveCount(0);
    await expect(operatorsRow).toHaveCount(0);
  }
}

test('an invited administrator chooses a password from the email and enters as administrator', async ({
  page,
  browser,
}, testInfo) => {
  const suffix = randomBytes(4).toString('hex');
  const name = `Invito ${suffix}`;
  const email = `invito-${suffix}@example.com`;
  const password = `scelta-${randomBytes(12).toString('base64url')}`;

  await openOperators(page);
  const form = page.getByRole('region', { name: 'Invita operatore' });
  await form.getByLabel('Nome').fill(name);
  await form.getByLabel('Email').fill(email);
  await form.getByRole('radio', { name: 'Amministratore' }).check();
  const since = new Date();
  await form.getByRole('button', { name: 'Invia invito' }).click();

  await expect(messages(page)).toHaveText(`Invito inviato a ${name}.`);
  await expect(row(page, name)).toContainText('Amministratore · invito inviato');
  // The form is empty again, the role back to Operatore.
  await expect(form.getByLabel('Nome')).toHaveValue('');
  await expect(form.getByLabel('Email')).toHaveValue('');
  await expect(form.getByRole('radio', { name: 'Operatore' })).toBeChecked();

  // One email, with the link of the template.
  const message = await waitForMessageTo(email, since);
  expect(message.subject).toBe('Enjoy Card: il tuo invito');
  const link = linkHref(message.html, 'Scegli la password');
  expect(link.startsWith(INVITE_PREFIX)).toBe(true);
  const url = new URL(link);
  expect(url.searchParams.get('type')).toBe('invite');
  expect(link).not.toContain(email);
  // A double send would show a second email by now: the invite went once.
  await page.waitForTimeout(1_000);
  expect(await messagesTo(email, since)).toHaveLength(1);

  // The invited person opens the link on their own phone.
  const { context, phone: invited, errors } = await newPhone(browser, testInfo);
  try {
    await invited.goto(link);
    await expect(invited.getByRole('heading', { level: 1, name: `Ciao, ${name}` })).toBeVisible();
    await expect(
      invited.getByText(
        `${ADMIN.name} ti ha invitato come amministratore dell’Enjoy Card. Scegli la password per accedere.`,
      ),
    ).toBeVisible();
    await invited.getByLabel('Nuova password').fill(password);
    await invited.getByLabel('Ripeti la password').fill(password);
    await invited.getByRole('button', { name: 'Salva e accedi' }).click();
    await expect(invited).toHaveURL('/');
    await expect(
      invited.getByRole('searchbox', { name: 'Cerca per nome o telefono' }),
    ).toBeVisible();
    await invited.getByRole('link', { name: `Account e impostazioni: ${name}` }).click();
    await expectSettingsOf(invited, 'admin');
    expect(errors, 'console errors of the invited phone').toEqual([]);
  } finally {
    await context.close();
  }

  // On the administrator's list the person is now active.
  await page.reload();
  await expect(row(page, name)).toContainText('Amministratore · attivo');
});

test('a role changed from the app reaches the open session at its next route, and back', async ({
  page,
  browser,
}, testInfo) => {
  const second = await openSecondPhone(browser, testInfo, ROLE.email);
  const { phone } = second;
  try {
    await phone.getByRole('link', { name: `Account e impostazioni: ${ROLE.name}` }).click();
    await expectSettingsOf(phone, 'operator');

    await openOperators(page);
    const changeRole = async (to: 'Amministratore' | 'Operatore', confirm: string) => {
      await row(page, ROLE.name)
        .getByRole('button', { name: new RegExp(`^${ROLE.name}`) })
        .click();
      const dialog = page.getByRole('dialog', { name: ROLE.name });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('radio', { name: to }).check();
      await dialog.getByRole('button', { name: 'Salva ruolo' }).click();
      await dialog.getByRole('button', { name: confirm }).click();
      await expect(dialog).toHaveCount(0);
    };

    await changeRole('Amministratore', 'Rendi amministratore');
    await expect(messages(page)).toHaveText(`${ROLE.name} è ora amministratore.`);
    await expect(row(page, ROLE.name)).toContainText('Amministratore · attivo');
    expect(storedState(ROLE.name)).toBe('admin/true');

    // The next route of the open session shows the administrator's settings.
    await phone.getByRole('link', { name: 'Indietro' }).click();
    await expect(phone).toHaveURL('/');
    await phone.getByRole('link', { name: `Account e impostazioni: ${ROLE.name}` }).click();
    await expectSettingsOf(phone, 'admin');

    await changeRole('Operatore', 'Rendi operatore');
    await expect(messages(page)).toHaveText(`${ROLE.name} è ora operatore.`);
    await expect(row(page, ROLE.name)).toContainText('Operatore · attivo');
    expect(storedState(ROLE.name)).toBe('operator/true');

    await phone.getByRole('link', { name: 'Indietro' }).click();
    await expect(phone).toHaveURL('/');
    await phone.getByRole('link', { name: `Account e impostazioni: ${ROLE.name}` }).click();
    await expectSettingsOf(phone, 'operator');
    expect(second.errors, 'console errors of the second phone').toEqual([]);
  } finally {
    await second.context.close();
    restoreOperator(ROLE.name);
  }
});

test('a deactivated person is sent to sign-in at the next route, and enters again once reactivated', async ({
  page,
  browser,
}, testInfo) => {
  const second = await openSecondPhone(browser, testInfo, DEACTIVATE.email);
  const { phone } = second;
  try {
    await expect(phone).toHaveURL('/');

    await openOperators(page);
    const target = row(page, DEACTIVATE.name);
    await target.getByRole('button', { name: 'Disattiva', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: `Disattivare ${DEACTIVATE.name}?` });
    await confirm.getByRole('button', { name: 'Disattiva', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(messages(page)).toHaveText(`${DEACTIVATE.name} è disattivato.`);
    await expect(target).toContainText('Operatore · disattivato, movimenti nello storico');
    expect(storedState(DEACTIVATE.name)).toBe('operator/false');

    // The open session goes back to sign-in with the message at its next route.
    await phone.getByRole('link', { name: `Account e impostazioni: ${DEACTIVATE.name}` }).click();
    await expect(phone).toHaveURL('/accedi');
    await expect(phone.getByText(NOT_ENABLED)).toBeVisible();
    // Signing in again is not enough while deactivated.
    await phone.getByLabel('Email').fill(DEACTIVATE.email);
    await phone.getByLabel('Password').fill(SEED_PASSWORD);
    await phone.getByRole('button', { name: 'Accedi' }).click();
    await expect(phone.getByText(NOT_ENABLED)).toBeVisible();
    await expect(phone).toHaveURL('/accedi');

    await target.getByRole('button', { name: 'Riattiva', exact: true }).click();
    const reactivate = page.getByRole('dialog', { name: `Riattivare ${DEACTIVATE.name}?` });
    await reactivate.getByRole('button', { name: 'Riattiva', exact: true }).click();
    await expect(reactivate).toHaveCount(0);
    await expect(messages(page)).toHaveText(`${DEACTIVATE.name} è di nuovo attivo.`);
    await expect(target).toContainText('Operatore · attivo');
    expect(storedState(DEACTIVATE.name)).toBe('operator/true');

    // The same password works again, back to the page the session was sent away from.
    await phone.getByLabel('Email').fill(DEACTIVATE.email);
    await phone.getByLabel('Password').fill(SEED_PASSWORD);
    await phone.getByRole('button', { name: 'Accedi' }).click();
    await expectSettingsOf(phone, 'operator');
    await expect(phone.getByRole('region', { name: 'Account', exact: true })).toContainText(
      DEACTIVATE.name,
    );
    await expect(phone.getByText(NOT_ENABLED)).toHaveCount(0);
    expect(second.errors, 'console errors of the second phone').toEqual([]);
  } finally {
    await second.context.close();
    restoreOperator(DEACTIVATE.name);
  }
});
