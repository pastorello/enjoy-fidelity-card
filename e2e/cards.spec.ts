import type { Page } from '@playwright/test';
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

/** Registers a customer with a new card from the home, as at the till; returns its id. */
async function customerWithCard(page: Page, prefix: string, uid: string) {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Lettura card' })).toContainText(
    'Avvicina la card',
  );
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  await expect(page).toHaveURL(`/clienti/nuovo?card=${uid}`);
  const name = uniqueName(prefix);
  await page.getByRole('textbox', { name: 'Nome e cognome' }).fill(name);
  await page.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ }).check();
  await page.getByRole('button', { name: 'Salva cliente' }).click();
  await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}\/spesa$/);
  const id = /\/clienti\/([0-9a-f-]{36})\/spesa$/.exec(page.url())?.[1];
  if (id === undefined) throw new Error('No customer id in the URL');
  return { id, name };
}

test.describe('Associa card', () => {
  // The card of another customer is refused by the server with a 400 (card_taken), shown on the page.
  test.use({ expectedRefusals: [/\/rest\/v1\/rpc\/associate_card$/] });

  test('a card of another customer is refused; a new one replaces the card, and the old one is deactivated (criteria 3, 5, 6)', async ({
    page,
  }) => {
    await stubWebNfc(page);
    await signIn(page);
    const antonioCard = freshUid();
    const mariaCard = freshUid();
    const antonio = await customerWithCard(page, 'Antonio Altro E2E', antonioCard);
    const maria = await customerWithCard(page, 'Maria Sostituisce E2E', mariaCard);

    await page.goto(`/clienti/${maria.id}/card`);
    await expect(page.getByRole('heading', { level: 1, name: 'Associa card' })).toBeVisible();
    const panel = page.getByRole('region', { name: 'Lettura card' });
    await expect(panel).toContainText('Avvicina la card nuova');
    await expect(
      page.getByText(
        `La card attuale (…${mariaCard.slice(-4)}) verrà disattivata. I punti restano a Maria.`,
      ),
    ).toBeVisible();

    // Antonio's card: "Card già associata", and his customer page from there.
    await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(antonioCard));
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Card già associata');
    await expect(alert).toContainText(
      `Questa card è di ${antonio.name}. Una card può essere di un solo cliente: usa un’altra card.`,
    );
    const retry = page.getByRole('button', { name: 'Riprova con un’altra card' });
    const open = page.getByRole('link', { name: 'Apri la scheda di Antonio' });
    const boxes = await Promise.all([retry.boundingBox(), open.boundingBox()]);
    for (const box of boxes) expect(box?.height).toBeGreaterThanOrEqual(48);
    await open.click();
    await expect(page).toHaveURL(`/clienti/${antonio.id}`);
    await expect(page.getByRole('heading', { level: 1, name: antonio.name })).toBeVisible();

    // A new card replaces Maria's: her customer page opens with the confirmation.
    await page.goto(`/clienti/${maria.id}/card`);
    await expect(panel).toContainText('Avvicina la card nuova');
    const newCard = freshUid();
    await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(newCard));
    await expect(page).toHaveURL(`/clienti/${maria.id}`);
    await expect(page.getByRole('status')).toContainText(
      `Card …${newCard.slice(-4)} associata. Link non scritto.`,
    );
    // The line under the name names the new card (SPEC-cards, point 6).
    await expect(page.getByText(`Card attiva …${newCard.slice(-4)} · `)).toBeVisible();

    // The old card, read on the home: deactivated, it does not open Registra spesa.
    await page.goto('/');
    await expect(panel).toContainText('Avvicina la card');
    await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(mariaCard));
    await expect(panel).toContainText('Card disattivata');
    await expect(panel).toContainText(`era di ${maria.name}`);
    await expect(page).toHaveURL('/');
  });
});

test('Modifica cliente: «Disattiva card» asks first, then the section says «Nessuna card attiva» (SPEC-cards, point 5)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page);
  const uid = freshUid();
  const label = `…${uid.slice(-4)}`;
  const customer = await customerWithCard(page, 'Maria Disattiva E2E', uid);

  await page.goto(`/clienti/${customer.id}/modifica`);
  const section = page.getByRole('region', { name: 'CARD' });
  await expect(section).toContainText(`Card attiva ${label} · dal `);
  const replace = section.getByRole('link', { name: 'Sostituisci card' });
  const deactivate = section.getByRole('button', { name: 'Disattiva card' });
  await expect(replace).toHaveAttribute('href', `/clienti/${customer.id}/card`);
  for (const box of await Promise.all([replace.boundingBox(), deactivate.boundingBox()])) {
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }

  await deactivate.click();
  const dialog = page.getByRole('dialog', { name: `Disattivare la card ${label}?` });
  await expect(dialog).toContainText('I punti restano a Maria.');
  await dialog.getByRole('button', { name: 'Disattiva card' }).click();

  await expect(dialog).toBeHidden();
  await expect(section).toContainText('Nessuna card attiva');
  const associate = section.getByRole('link', { name: 'Associa card' });
  await expect(associate).toHaveAttribute('href', `/clienti/${customer.id}/card`);
  expect((await associate.boundingBox())?.height).toBeGreaterThanOrEqual(48);

  // Saved on the server: the card read on the home no longer opens Registra spesa.
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Lettura card' });
  await expect(panel).toContainText('Avvicina la card');
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  await expect(panel).toContainText('Card disattivata');
  await expect(page).toHaveURL('/');
});
