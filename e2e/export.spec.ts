import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import { seedAccounts, signIn } from './auth';
import { expect, test } from './fixtures';
import { customerWithCard, freshUid, stubWebNfc } from './nfc';

/**
 * ESPORTA DATI end to end (docs/specs/SPEC-export.md, criteria 1, 3, 7, 8 and 9), against the local
 * stack. The test's customer and purchase are made with the UI, as at the till; the ratio in force
 * is the initial one (1 punto ogni 1,00 €): the specs that change it run after these
 * (`phone-settings` in playwright.config.ts) and put it back.
 */

const BOM = '﻿';
const CUSTOMERS_HEADER =
  'Codice cliente;Nome;Telefono;Card attiva;Saldo punti;Consenso privacy;Note;Creato il;Creato da;Anonimizzato il';
const MOVEMENTS_HEADER =
  'Data e ora;Codice movimento;Codice cliente;Cliente;Tipo;Importo €;Punti;Euro per punto;Premio o descrizione;Operatore;Annulla il movimento;Annullato da';
const NETWORK_MESSAGE = 'Esportazione non riuscita: controlla la connessione e riprova.';
const EXPORT_CUSTOMERS_RPC = /\/rest\/v1\/rpc\/export_customers(\?.*)?$/;

/** Today in Rome as AAAA-MM-GG, computed here independently of the app (criterion 8). */
function romeToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Escapes a literal for use inside a RegExp. */
function literal(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** /impostazioni, once the profile is loaded (the account box names the role). */
async function openSettings(page: Page, role: 'Amministratore' | 'Operatore') {
  await page.goto('/impostazioni');
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Account', exact: true }).getByText(role, { exact: true }),
  ).toBeVisible();
}

/** Taps `name` and returns the saved file and its text (BOM kept: read as bytes, decoded as UTF-8). */
async function exportFile(page: Page, name: string): Promise<{ download: Download; text: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name }).click(),
  ]);
  const path = await download.path();
  const bytes = await readFile(path);
  // EF BB BF: the UTF-8 byte order mark Excel needs to read the accents (SPEC-export, point 4).
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return { download, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) };
}

/** Types an amount on the app's keypad, digit by digit, as on a POS. */
async function typeAmount(page: Page, digits: string) {
  const keypad = page.getByRole('group', { name: 'Tastierino numerico' });
  // One key after the other: the order of the digits is the amount.
  await digits
    .split('')
    .reduce(
      (typed, digit) =>
        typed.then(() => keypad.getByRole('button', { name: digit, exact: true }).click()),
      Promise.resolve(),
    );
}

test('an administrator downloads Clienti and Movimenti CSV with the test customer and its 12,50 € purchase (criteria 3, 8, 9)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page, seedAccounts.admin.email);
  const uid = freshUid();
  const customer = await customerWithCard(page, 'Export E2E', uid);
  await expect(page.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeVisible();
  await typeAmount(page, '1250');
  await page.getByRole('button', { name: 'Conferma +12' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeVisible();

  await openSettings(page, 'Amministratore');

  // Layout at 390×844 (criterion 9): the last section, its title, the buttons side by side.
  const section = page.getByRole('region', { name: 'ESPORTA DATI' });
  await expect(page.locator('main > :last-child')).toHaveAttribute(
    'aria-labelledby',
    'settings-export',
  );
  await expect(section.getByRole('heading', { level: 2 })).toHaveText('ESPORTA DATI');
  const customersButton = section.getByRole('button', { name: 'Clienti CSV' });
  const movementsButton = section.getByRole('button', { name: 'Movimenti CSV' });
  await expect(customersButton.locator('svg')).toHaveCount(1);
  await expect(movementsButton.locator('svg')).toHaveCount(1);
  const [left, right] = await Promise.all([
    customersButton.boundingBox(),
    movementsButton.boundingBox(),
  ]);
  if (left === null || right === null) throw new Error('The export buttons are not laid out.');
  expect(left.height).toBeGreaterThanOrEqual(48);
  expect(right.height).toBeGreaterThanOrEqual(48);
  expect(left.width).toBeGreaterThanOrEqual(48);
  expect(right.width).toBeGreaterThanOrEqual(48);
  expect(right.y).toBe(left.y);
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  expect(right.x + right.width).toBeLessThanOrEqual(390);

  const today = romeToday();

  const customers = await exportFile(page, 'Clienti CSV');
  expect(customers.download.suggestedFilename()).toBe(`enjoy-clienti-${today}.csv`);
  const customerLines = customers.text.split('\r\n');
  expect(customerLines[0]).toBe(BOM + CUSTOMERS_HEADER);
  const customerRow = customerLines.find((line) => line.startsWith(`${customer.id};`));
  // Code, name, no phone, the active card as Excel text (="…", quoted because it holds quotes),
  // balance 12, consent, no notes, creator, not anonymized.
  expect(customerRow).toMatch(
    new RegExp(
      `^${customer.id};${literal(customer.name)};;"=""${uid}""";12;\\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}:\\d{2};;\\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}:\\d{2};${seedAccounts.admin.name};$`,
    ),
  );
  await expect(section.getByRole('status')).toHaveText(/^Clienti esportati: [\d.]+\.$/);

  const movements = await exportFile(page, 'Movimenti CSV');
  expect(movements.download.suggestedFilename()).toBe(`enjoy-movimenti-${today}.csv`);
  const movementLines = movements.text.split('\r\n');
  expect(movementLines[0]).toBe(BOM + MOVEMENTS_HEADER);
  const purchases = movementLines.filter((line) => line.split(';')[2] === customer.id);
  // The one purchase: 12,50 €, 12 points, ratio 1,00 € per point, by the admin, not corrected.
  expect(purchases).toHaveLength(1);
  expect(purchases[0]).toMatch(
    new RegExp(
      `^\\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}:\\d{2};[0-9a-f-]{36};${customer.id};${literal(customer.name)};Spesa;12,50;12;1,00;;${seedAccounts.admin.name};;$`,
    ),
  );
  await expect(section.getByRole('status')).toHaveText(/^Movimenti esportati: [\d.]+\.$/);
});

test.describe('Esportazione non riuscita', () => {
  // The aborted request is logged by the browser as a failed load.
  test.use({ expectedRefusals: [EXPORT_CUSTOMERS_RPC] });

  test('an aborted export RPC saves no file and says to retry; the next tap downloads (criterion 7)', async ({
    page,
  }) => {
    await signIn(page, seedAccounts.admin.email);
    await openSettings(page, 'Amministratore');
    const section = page.getByRole('region', { name: 'ESPORTA DATI' });

    const downloads: Download[] = [];
    page.on('download', (download) => downloads.push(download));
    await page.route(EXPORT_CUSTOMERS_RPC, (route) => route.abort('internetdisconnected'));

    const button = section.getByRole('button', { name: 'Clienti CSV' });
    await button.click();
    await expect(section.getByRole('status')).toHaveText(NETWORK_MESSAGE);
    await expect(button).not.toHaveAttribute('aria-busy');
    expect(downloads).toEqual([]);

    await page.unroute(EXPORT_CUSTOMERS_RPC);
    const retry = await exportFile(page, 'Clienti CSV');
    expect(retry.download.suggestedFilename()).toBe(`enjoy-clienti-${romeToday()}.csv`);
    expect(retry.text.split('\r\n')[0]).toBe(BOM + CUSTOMERS_HEADER);
    await expect(section.getByRole('status')).toHaveText(/^Clienti esportati: [\d.]+\.$/);
    expect(downloads).toHaveLength(1);
  });
});

test('an operator does not see ESPORTA DATI (criterion 1)', async ({ page }) => {
  await signIn(page, seedAccounts.operator.email);
  await openSettings(page, 'Operatore');
  await expect(page.getByRole('heading', { level: 2, name: 'ESPORTA DATI' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clienti CSV' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Movimenti CSV' })).toHaveCount(0);
});
