import { SEED_PASSWORD, seedAccounts, signIn } from './auth';
import { expect, test } from './fixtures';

test('without a session the app opens the sign-in page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/accedi');
  await expect(page.getByRole('heading', { level: 1, name: 'Accedi' })).toBeVisible();
});

test('a seed operator signs in and reaches the home', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('searchbox', { name: 'Cerca per nome o telefono' })).toBeVisible();
});

test('wrong credentials get one generic message', async ({ page }) => {
  await page.goto('/accedi');
  await page.getByLabel('Email').fill(seedAccounts.operator.email);
  await page.getByLabel('Password').fill('password-sbagliata');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email o password non corretti.');

  await page.getByLabel('Email').fill('nessuno@example.com');
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email o password non corretti.');
});

test('after signing in the app returns to the page asked for', async ({ page }) => {
  await page.goto('/?da=e2e');
  await expect(page).toHaveURL('/accedi');
  await page.getByLabel('Email').fill(seedAccounts.admin.email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page).toHaveURL('/?da=e2e');
});

test('the session survives a reload', async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('searchbox', { name: 'Cerca per nome o telefono' })).toBeVisible();
});

test('settings show the account and "Esci" ends the session', async ({ page }) => {
  await signIn(page, seedAccounts.admin.email);
  await page
    .getByRole('link', { name: `Account e impostazioni: ${seedAccounts.admin.name}` })
    .click();
  await expect(page).toHaveURL('/impostazioni');
  // Exact: the ACCOUNT section ("Cambia password") is a second region with the same word.
  const account = page.getByRole('region', { name: 'Account', exact: true });
  await expect(account).toContainText(seedAccounts.admin.name);
  await expect(account).toContainText('Amministratore');

  await page.getByRole('button', { name: 'Esci' }).click();
  await expect(page).toHaveURL('/accedi');
  await expect(page.getByText(/sessione è scaduta/)).toHaveCount(0);

  // Going back does not reopen a page behind the sign-in.
  await page.goBack();
  await expect(page).toHaveURL('/accedi');
  await page.goto('/impostazioni');
  await expect(page).toHaveURL('/accedi');
});

test('touch targets of the settings page are at least 48 px', async ({ page }) => {
  await signIn(page);
  await page.goto('/impostazioni');
  const boxes = await Promise.all(
    [
      page.getByRole('link', { name: 'Indietro' }),
      page.getByRole('button', { name: 'Esci' }),
      page.getByRole('link', { name: /Cambia password/ }),
    ].map((target) => target.boundingBox()),
  );
  for (const box of boxes) {
    expect(box?.height).toBeGreaterThanOrEqual(48);
    expect(box?.width).toBeGreaterThanOrEqual(48);
  }
});

test('"Password dimenticata?" on the sign-in page is a 48 px target to the recovery page', async ({
  page,
}) => {
  await page.goto('/accedi');
  const link = page.getByRole('link', { name: 'Password dimenticata?' });
  const box = await link.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);
  expect(box?.width).toBeGreaterThanOrEqual(48);
  await link.click();
  await expect(page).toHaveURL('/password-dimenticata');
  await expect(page.getByRole('heading', { level: 1, name: 'Password dimenticata' })).toBeVisible();
});

test('touch targets of the forgot-password page are at least 48 px', async ({ page }) => {
  await page.goto('/password-dimenticata');
  await expect(page.getByRole('heading', { level: 1, name: 'Password dimenticata' })).toBeVisible();
  const boxes = await Promise.all(
    [
      page.getByRole('link', { name: 'Indietro' }),
      page.getByLabel('Email'),
      page.getByRole('button', { name: 'Invia il link' }),
    ].map((target) => target.boundingBox()),
  );
  for (const box of boxes) {
    expect(box?.height).toBeGreaterThanOrEqual(48);
    expect(box?.width).toBeGreaterThanOrEqual(48);
  }
});

test('touch targets of the reset-password page are at least 48 px', async ({ page }) => {
  // A made-up token: opening the page never consumes or checks it.
  await page.goto('/imposta-password?token_hash=e2e-non-valido&type=recovery');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Scegli una nuova password' }),
  ).toBeVisible();
  const boxes = await Promise.all(
    [
      page.getByLabel('Nuova password'),
      page.getByLabel('Ripeti la password'),
      page.getByRole('button', { name: 'Salva e accedi' }),
    ].map((target) => target.boundingBox()),
  );
  for (const box of boxes) {
    expect(box?.height).toBeGreaterThanOrEqual(48);
    expect(box?.width).toBeGreaterThanOrEqual(48);
  }

  await page.goto('/imposta-password');
  const again = page.getByRole('link', { name: 'Chiedi un nuovo link' });
  expect((await again.boundingBox())?.height).toBeGreaterThanOrEqual(48);
});
