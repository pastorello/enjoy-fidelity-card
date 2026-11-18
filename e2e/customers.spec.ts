import { signIn } from './auth';
import { expect, test } from './fixtures';

/** Customers end to end (SPEC-customers). The full admin and operator journeys come with Task 15. */

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
      page.getByLabel('Telefono (facoltativo)'),
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
  await page.getByLabel('Telefono (facoltativo)').fill('333 000 9876');
  await page.getByText('Ha letto l’informativa privacy').click();
  await page.getByRole('button', { name: 'Salva cliente' }).click();

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Tel. 333 ••• 9876')).toBeVisible();
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
