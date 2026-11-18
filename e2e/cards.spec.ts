import { signIn } from './auth';
import { expect, test } from './fixtures';
import { fakeCardWrites, stubWebNfc } from './nfc';

/**
 * Cards end to end (docs/specs/SPEC-cards.md, Testing Strategy), against the local stack. Web NFC
 * does not exist in Playwright: the E2E build reads cards from `window.__enjoyFakeCard`.
 */

/** A 7-byte uid nobody has used yet (a uid belongs to one customer forever), canonical. */
function freshUid(): string {
  const bytes = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  );
  return `04${bytes.join('')}`.toUpperCase();
}

/** The uid as Web NFC gives it: lower case, colon-separated. */
function asWebNfc(uid: string): string {
  return (uid.toLowerCase().match(/../g) ?? []).join(':');
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

test('a new card on the home opens Nuovo cliente with it, then Registra spesa; read again, it opens the customer (criteria 1, 2, 14)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page);
  const panel = page.getByRole('region', { name: 'Lettura card' });
  await expect(panel).toContainText('Avvicina la card');

  const uid = freshUid();
  const firstRead = Date.now();
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));

  await expect(page).toHaveURL(`/clienti/nuovo?card=${uid}`);
  await expect(page.getByRole('region', { name: 'Card letta' })).toContainText(
    `Codice ${uid}: non è di nessun cliente, verrà associata a questo.`,
  );

  const name = uniqueName('Card Nuova E2E');
  await page.getByRole('textbox', { name: 'Nome e cognome' }).fill(name);
  await page.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ }).check();
  await page.getByRole('button', { name: 'Salva cliente' }).click();

  await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}\/spesa$/);
  const purchaseUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();

  // Nuovo cliente was replaced in the history: going back lands on the home, not on the form.
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(panel).toContainText('Avvicina la card');

  // The same card, read again: Registra spesa of the new customer, with no tap, within 2 s. The
  // reader ignores the same uid within REPEAT_WINDOW_MS (2 s, src/features/card-input/cardReader.ts)
  // of its last read, as a card still held: the second read comes after it, as at the till.
  await page.waitForTimeout(Math.max(0, firstRead + 2500 - Date.now()));
  const started = Date.now();
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  await expect(page).toHaveURL(purchaseUrl, { timeout: 2000 });
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible({ timeout: 2000 });
  expect(Date.now() - started).toBeLessThan(2000);

  // The way from the card to the purchase never writes the card (criterion 14).
  expect(await fakeCardWrites(page)).toEqual([]);
});
