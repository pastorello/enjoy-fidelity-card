import { randomBytes, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { SEED_PASSWORD, seedAccounts } from './auth';
import { expect, test } from './fixtures';
import { linkHref, messagesTo, waitForMessageTo } from './mailpit';

/**
 * Password recovery end to end, with the email read from Mailpit (local stack only).
 * `fullyParallel` is on: only the first test changes a password, and only of
 * `recupero@example.com`, which no other test signs in with. The new password is random and the
 * rejected "old" one is the seed's, so a second run without `db:reset` stays green.
 */

const LINK_PREFIX = 'http://localhost:4173/imposta-password?token_hash=';
const CONFIRMATION = /Se l’email è di un account dell’Enjoy Card, ti abbiamo mandato un link\./;

async function requestLink(page: Page, email: string) {
  await page.goto('/accedi');
  await page.getByRole('link', { name: 'Password dimenticata?' }).click();
  await expect(page).toHaveURL('/password-dimenticata');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Invia il link' }).click();
  await expect(page.getByText(CONFIRMATION)).toBeVisible();
}

async function submitSignIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Accedi' }).click();
}

async function chooseNewPassword(page: Page, password: string) {
  await page.getByLabel('Nuova password').fill(password);
  await page.getByLabel('Ripeti la password').fill(password);
  await page.getByRole('button', { name: 'Salva e accedi' }).click();
}

test('a forgotten password is replaced through the emailed link, which works once', async ({
  page,
}) => {
  const { email, name } = seedAccounts.recovery;
  const newPassword = `nuova-${randomBytes(12).toString('base64url')}`;

  const since = new Date();
  await requestLink(page, email);
  const message = await waitForMessageTo(email, since);
  expect(message.subject).toBe('Enjoy Card: scegli una nuova password');
  const link = linkHref(message.html, 'Scegli la password');
  expect(link.startsWith(LINK_PREFIX)).toBe(true);
  expect(new URL(link).searchParams.get('type')).toBe('recovery');

  // The link opens the page; the password changes and the operator lands on the home.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Scegli una nuova password' })).toBeVisible();
  await chooseNewPassword(page, newPassword);
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('searchbox', { name: 'Cerca per nome o telefono' })).toBeVisible();

  await page.getByRole('link', { name: `Account e impostazioni: ${name}` }).click();
  await page.getByRole('button', { name: 'Esci' }).click();
  await expect(page).toHaveURL('/accedi');

  // The old (seed) password no longer works.
  await submitSignIn(page, email, SEED_PASSWORD);
  await expect(page.getByRole('alert')).toHaveText('Email o password non corretti.');

  // The link reopened after use is refused and offers a new one; nothing changes.
  await page.goto(link);
  await chooseNewPassword(page, `altra-${randomBytes(12).toString('base64url')}`);
  await expect(
    page.getByRole('heading', { name: 'Il link è scaduto o è già stato usato.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Chiedi un nuovo link' }).click();
  await expect(page).toHaveURL('/password-dimenticata');

  // The new password signs in.
  await page.goto('/accedi');
  await submitSignIn(page, email, newPassword);
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('searchbox', { name: 'Cerca per nome o telefono' })).toBeVisible();
});

test('an unknown email gets the same confirmation and no email', async ({ page }) => {
  const email = `nessuno-${randomUUID()}@example.com`;
  const since = new Date();
  await requestLink(page, email);
  // Auth sends the email before answering the request, so by now it would already be in Mailpit;
  // a short grace period covers a slow SMTP hand-off. Proving an absence needs a fixed wait.
  await page.waitForTimeout(1_500);
  expect(await messagesTo(email, since)).toEqual([]);
});

test('"Cambia password" from the settings prefills the account email', async ({ page }) => {
  const { email } = seedAccounts.operator;
  await page.goto('/accedi');
  await submitSignIn(page, email, SEED_PASSWORD);
  await expect(page).toHaveURL('/');

  await page.goto('/impostazioni');
  await page.getByRole('link', { name: /Cambia password/ }).click();
  await expect(page).toHaveURL('/password-dimenticata');
  await expect(page.getByLabel('Email')).toHaveValue(email);

  const since = new Date();
  await page.getByRole('button', { name: 'Invia il link' }).click();
  await expect(page.getByText(CONFIRMATION)).toBeVisible();
  await page.getByRole('link', { name: 'Torna alle impostazioni' }).click();
  await expect(page).toHaveURL('/impostazioni');
  // The email is sent, but its link is never opened: this account's password stays the seed's.
  const message = await waitForMessageTo(email, since);
  expect(linkHref(message.html, 'Scegli la password').startsWith(LINK_PREFIX)).toBe(true);
});
