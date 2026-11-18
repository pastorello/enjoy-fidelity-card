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
