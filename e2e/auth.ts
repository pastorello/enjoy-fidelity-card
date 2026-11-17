import { expect, type Page } from '@playwright/test';

/** Fake accounts created by supabase/seed.sql (local stack only). */
export const seedAccounts = {
  admin: { email: 'admin@example.com', name: 'Admin Prova' },
  operator: { email: 'operatore@example.com', name: 'Operatore Prova' },
  /** Reserved to e2e/password.spec.ts, which changes its password: no other test signs in with it. */
  recovery: { email: 'recupero@example.com', name: 'Recupero Prova' },
} as const;
export const SEED_PASSWORD = 'password-di-prova';

export async function signIn(page: Page, email: string = seedAccounts.operator.email) {
  await page.goto('/accedi');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page).not.toHaveURL(/\/accedi/);
}
