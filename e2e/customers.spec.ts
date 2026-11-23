import type { Page } from '@playwright/test';
import { seedAccounts, signIn } from './auth';
import { expect, homeCustomers, homeSearch, test } from './fixtures';

/**
 * Customers end to end (SPEC-customers). Names carry a suffix unique to the run, so the suite also
 * passes again without `db:reset`, and a run that failed halfway leaves no name in the way.
 */

/** A suffix unique to this run and this test (tests run in parallel). */
function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A seed customer (supabase/seed.sql): the name a rename collides with. */
const SEED_CUSTOMER = 'Giulia Bianchi';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Nuovo cliente from the home's button, filled and saved: ends on the new customer's page. */
async function createCustomer(page: Page, name: string, email?: string) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Nuovo cliente' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nuovo cliente' })).toBeVisible();
  await page.getByLabel('Nome e cognome').fill(name);
  if (email !== undefined) await page.getByLabel('Email (facoltativa)').fill(email);
  await page.getByText('Ha letto l’informativa privacy').click();
  await page.getByRole('button', { name: 'Salva cliente' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}$/);
}

/** Types in the home search (the results come after a short pause). */
async function search(page: Page, text: string) {
  await homeSearch(page).fill(text);
}

function resultRow(page: Page, name: string) {
  return homeCustomers(page).getByRole('link', {
    name: new RegExp(`^${escapeRegExp(name)}\\b`),
  });
}

test.describe('administrator', () => {
  // The rename onto a name already used is refused by the server with a 400, shown on the form.
  test.use({ expectedRefusals: [/\/rest\/v1\/rpc\/update_customer$/] });

  test('creates, finds, edits and erases a customer', async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `Nicolò Prova E2E ${suffix}`;
    await signIn(page, seedAccounts.admin.email);

    // Stored trimmed and lowercase by the server (SPEC-customers-v2, point 2).
    const email = `nicolo.${suffix}@example.com`;
    await createCustomer(page, name, `  Nicolo.${suffix}@Example.COM `);
    await expect(page.getByRole('region', { name: 'SALDO' })).toContainText('0 punti');
    // Scheda cliente: the email in full, never a link to write to the customer.
    await expect(page.getByRole('main').getByText(email)).toBeVisible();
    await expect(page.locator('[href^="mailto:" i]')).toHaveCount(0);
    const customerUrl = page.url();

    // Found without the accent in CLIENTI, which never shows the email (SPEC-customers-v2 point
    // 6). The search names this run's customer in full: customers left by other runs never push
    // it past the first page.
    await page.goto('/');
    await search(page, `nicolo prova e2e ${suffix}`);
    await expect(homeCustomers(page).getByRole('link')).toHaveCount(1);
    await expect(resultRow(page, name)).toContainText('Nessun movimento');
    await expect(resultRow(page, name)).not.toContainText('@');
    // The text stays out of the URL.
    expect(new URL(page.url()).search).toBe('');
    await resultRow(page, name).click();
    await expect(page).toHaveURL(customerUrl);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    // Modifica cliente shows the stored email; a new one is saved, and emptied it is removed.
    await page.getByRole('link', { name: 'Modifica cliente' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Modifica cliente' })).toBeVisible();
    await expect(page.getByLabel('Email (facoltativa)')).toHaveValue(email);
    await page.getByLabel('Email (facoltativa)').fill(`nicolo.bar.${suffix}@example.com`);
    await page.getByRole('button', { name: 'Salva modifiche' }).click();
    await expect(page).toHaveURL(customerUrl);
    await page.getByRole('link', { name: 'Modifica cliente' }).click();
    await expect(page.getByLabel('Email (facoltativa)')).toHaveValue(
      `nicolo.bar.${suffix}@example.com`,
    );
    await page.getByLabel('Email (facoltativa)').fill('');
    await page.getByRole('button', { name: 'Salva modifiche' }).click();
    await expect(page).toHaveURL(customerUrl);
    await page.getByRole('link', { name: 'Modifica cliente' }).click();
    await expect(page.getByLabel('Email (facoltativa)')).toHaveValue('');
    await page.goto(customerUrl);

    // A name already used is refused, under the name field, and nothing changes.
    await page.getByRole('link', { name: 'Modifica cliente' }).click();
    await page.getByLabel('Nome e cognome').fill(SEED_CUSTOMER);
    await page.getByRole('button', { name: 'Salva modifiche' }).click();
    await expect(page.getByText('Esiste già un cliente con questo nome.')).toBeVisible();
    await expect(page).toHaveURL(`${customerUrl}/modifica`);

    // DATI DEL CLIENTE: the erase asks first, then opens the home with the message.
    await expect(page.getByRole('heading', { level: 2, name: 'DATI DEL CLIENTE' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancella i dati del cliente' }).click();
    const dialog = page.getByRole('dialog', { name: `Cancellare i dati di ${name}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancella i dati' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Dati del cliente cancellati.')).toBeVisible();

    // Not found any more by name; the page keeps the balance without personal data.
    await search(page, name);
    await expect(page.getByRole('heading', { name: 'Nessun cliente trovato' })).toBeVisible();
    await expect(resultRow(page, name)).toHaveCount(0);
    await page.goto(customerUrl);
    await expect(page.getByRole('heading', { level: 1, name: 'Cliente cancellato' })).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Modifica cliente' })).toHaveCount(0);
  });
});

test('an operator creates a customer with only the name and the consent, and cannot erase data', async ({
  page,
}) => {
  const name = `Operatore Cliente E2E ${uniqueSuffix()}`;
  await signIn(page, seedAccounts.operator.email);

  await createCustomer(page, name);
  await expect(page.getByText('Senza email')).toBeVisible();
  await expect(page.getByRole('region', { name: 'SALDO' })).toContainText('0 punti');

  await page.getByRole('link', { name: 'Modifica cliente' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Modifica cliente' })).toBeVisible();
  await expect(page.getByLabel('Nome e cognome')).toHaveValue(name);
  await expect(page.getByRole('heading', { name: 'DATI DEL CLIENTE' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancella i dati del cliente' })).toHaveCount(0);
});

test('Scheda cliente: an 80-character name cut by the header is shown in full in the page', async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  const name = `Maria Giovanna Esposito De Laurentiis Serapo Formia Lungomare ${suffix}`.padEnd(
    80,
    'x',
  );
  expect(name).toHaveLength(80);
  await signIn(page);
  await createCustomer(page, name);
  const main = page.getByRole('main');
  await expect(main.getByText(name, { exact: true })).toBeVisible();
  // The whole name fits in the page: nothing of it is clipped or runs off the screen.
  const line = main.getByText(name, { exact: true });
  expect(await line.evaluate((element) => getComputedStyle(element).overflow)).toBe('visible');
  const box = await line.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect((box?.x ?? Infinity) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
});

test('Scheda cliente: a short name is not repeated under the header', async ({ page }) => {
  const name = `Breve ${uniqueSuffix()}`;
  await signIn(page);
  await createCustomer(page, name);
  await expect(page.getByText('Senza email')).toBeVisible();
  await expect(page.getByRole('main').getByText(name, { exact: true })).toHaveCount(0);
});

test('Nuovo cliente: touch targets are at least 48 px and the notice opens and closes', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/clienti/nuovo');
  await expect(page.getByRole('heading', { level: 1, name: 'Nuovo cliente' })).toBeVisible();

  const consent = page.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ });
  const boxes = await Promise.all(
    [
      page.getByRole('link', { name: 'Indietro' }),
      page.getByLabel('Nome e cognome'),
      page.getByLabel('Email (facoltativa)'),
      // The touch area of the checkbox is its whole label row.
      page.locator('label', { has: consent }),
      page.getByRole('button', { name: 'Mostra l’informativa' }),
      page.getByLabel('Note (facoltative)'),
      page.getByRole('button', { name: 'Salva cliente' }),
    ].map((target) => target.boundingBox()),
  );
  for (const box of boxes) {
    expect(box?.height).toBeGreaterThanOrEqual(48);
    expect(box?.width).toBeGreaterThanOrEqual(48);
  }

  // Tapping the label text ticks the box.
  await page.getByText('Ha letto l’informativa privacy').click();
  await expect(consent).toBeChecked();

  const opener = page.getByRole('button', { name: 'Mostra l’informativa' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Informativa privacy' });
  await expect(dialog).toContainText(
    'Testo dell’informativa in attesa di verifica del consulente del bar.',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Nuovo cliente: a wrong form shows the errors and saves nothing', async ({ page }) => {
  await signIn(page);
  await page.goto('/clienti/nuovo');
  await page.getByRole('button', { name: 'Salva cliente' }).click();
  await expect(page.getByLabel('Nome e cognome')).toBeFocused();
  await expect(page.getByText('Scrivi nome e cognome.')).toBeVisible();
  await expect(
    page.getByText('Serve il consenso privacy per registrare il cliente.'),
  ).toBeVisible();
  await expect(page).toHaveURL('/clienti/nuovo');
});

test('Scheda cliente: the saved customer opens with SALDO, and the header buttons are 48 px', async ({
  page,
}) => {
  const name = `Scheda Prova E2E ${Date.now().toString(36)}`;
  await signIn(page);
  await page.goto('/clienti/nuovo');
  await page.getByLabel('Nome e cognome').fill(name);
  await page
    .getByLabel('Email (facoltativa)')
    .fill(`scheda.${Date.now().toString(36)}@example.com`);
  await page.getByText('Ha letto l’informativa privacy').click();
  await page.getByRole('button', { name: 'Salva cliente' }).click();

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('region', { name: 'SALDO' })).toContainText('0 punti');

  const boxes = await Promise.all(
    [
      page.getByRole('link', { name: 'Indietro' }),
      page.getByRole('link', { name: 'Modifica cliente' }),
    ].map((target) => target.boundingBox()),
  );
  for (const box of boxes) {
    expect(box?.height).toBeGreaterThanOrEqual(48);
    expect(box?.width).toBeGreaterThanOrEqual(48);
  }
});

test('Scheda cliente: an id that is not a customer says "Cliente non trovato"', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/clienti/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: 'Cliente non trovato' })).toBeVisible();
  await page.goto('/clienti/non-un-id');
  await expect(page.getByRole('heading', { name: 'Cliente non trovato' })).toBeVisible();
  await page.getByRole('link', { name: 'Torna all’inizio' }).click();
  await expect(page).toHaveURL('/');
});
