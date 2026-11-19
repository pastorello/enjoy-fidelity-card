import { expect, type Page } from '@playwright/test';

/** Fake accounts created by supabase/seed.sql (local stack only). */
export const seedAccounts = {
  admin: { email: 'admin@example.com', name: 'Admin Prova' },
  operator: { email: 'operatore@example.com', name: 'Operatore Prova' },
  /** Reserved to e2e/password.spec.ts, which changes its password: no other test signs in with it. */
  recovery: { email: 'recupero@example.com', name: 'Recupero Prova' },
  /**
   * Reserved to e2e/tablet-pin.spec.ts, which sets its till PIN from the phone (it starts without
   * one): no other test signs in with it or unlocks the till with it.
   */
  pin: { email: 'pin@example.com', name: 'Pin Prova' },
} as const;

/**
 * Fake device accounts of the till tablet (supabase/seed.sql, tablet-kiosk). `till` is the tablet
 * of the E2E flows; `lockedTill` is reserved to the 5-wrong-PIN test, so its lock never stops the
 * others; `pinTill` is reserved to e2e/tablet-pin.spec.ts, so its cashier never replaces the one of
 * the tests on `till` running at the same time.
 */
export const seedDevices = {
  till: { email: 'cassa@example.com', name: 'Tablet cassa' },
  lockedTill: { email: 'cassa-blocco@example.com', name: 'Tablet blocco' },
  pinTill: { email: 'cassa-pin@example.com', name: 'Tablet cambio PIN' },
} as const;

/** Fake till PINs of the seed operators (supabase/seed.sql). */
export const SEED_PINS = { admin: '2468', operator: '1357' } as const;
export const SEED_PASSWORD = 'password-di-prova';

export async function signIn(page: Page, email: string = seedAccounts.operator.email) {
  await page.goto('/accedi');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page).not.toHaveURL(/\/accedi/);
}

/** Signs in the till tablet with a device account: the app goes to "Chi è alla cassa?". */
export async function signInDevice(page: Page, email: string = seedDevices.till.email) {
  await page.goto('/accedi');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page).toHaveURL(/\/cassa$/);
  await expect(page.getByRole('heading', { name: 'Chi è alla cassa?' })).toBeVisible();
}
