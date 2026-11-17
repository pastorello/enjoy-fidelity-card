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
  await expect(page.getByText('Enjoy Card è quasi pronta')).toBeVisible();
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
  await expect(page.getByText('Enjoy Card è quasi pronta')).toBeVisible();
});
