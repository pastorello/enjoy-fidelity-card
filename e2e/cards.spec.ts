import { seedAccounts, signIn } from './auth';
import { expect, test } from './fixtures';
import {
  asWebNfc,
  customerWithCard,
  fakeCardWrites,
  freshUid,
  stubWebNfc,
  tapUntilWritten,
  uniqueName,
  writeAfterSave,
} from './nfc';

/**
 * Cards end to end (docs/specs/SPEC-cards.md, Testing Strategy), against the local stack. Web NFC
 * does not exist in Playwright: the E2E build reads cards from `window.__enjoyFakeCard`.
 */

test('a new card on the home opens Nuovo cliente with it, its link is written, then Registra spesa; read again, it opens the customer (criteria 1, 2, 10, 14)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page);
  const panel = page.getByRole('region', { name: 'Lettura card' });
  await expect(panel).toContainText('Avvicina la card');

  const uid = freshUid();
  const firstRead = Date.now();
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));

  // The uid travels in the history state, never in the URL (SPEC-customers-v2 point 6).
  await expect(page).toHaveURL('/clienti/nuovo');
  const cardRead = page.getByRole('region', { name: 'Card letta' });
  await expect(cardRead).toContainText(
    `Codice ${uid}: non è di nessun cliente, verrà associata a questo.`,
  );
  // The history state survives a reload, as ?card= did.
  await page.reload();
  await expect(cardRead).toContainText(`Codice ${uid}:`);
  expect(page.url()).not.toContain(uid);

  const name = uniqueName('Card Nuova E2E');
  await page.getByRole('textbox', { name: 'Nome e cognome' }).fill(name);
  await page.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ }).check();
  // The form takes more than 1.5 s (IN_FIELD_MS), as at the till: the card is no longer in the field.
  await page.waitForTimeout(Math.max(0, firstRead + 1600 - Date.now()));
  await page.getByRole('button', { name: 'Salva cliente' }).click();

  // The customer is saved with the card: the link is written on it, then Registra spesa opens.
  // The write asks for the card again, and the operator puts it back on the phone.
  const writer = page.getByRole('region', { name: 'Scrittura del link' });
  await expect(writer).toContainText(`Avvicina la card …${uid.slice(-4)}`);
  await expect(page.getByText('Card associata a Card')).toBeVisible();
  const skip = page.getByRole('button', { name: 'Salta, lo scrivo più tardi' });
  expect((await skip.boundingBox())?.height).toBeGreaterThanOrEqual(48);
  const lastTap =
    (await writeAfterSave(page, uid, /\/clienti\/[0-9a-f-]{36}\/spesa$/)) ?? firstRead;
  const purchaseUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();

  // Nuovo cliente was replaced in the history: going back lands on the home, not on the form.
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(panel).toContainText('Avvicina la card');

  // The link written on the card: a random token, never the uid (criterion 10).
  const written = await fakeCardWrites(page);
  const forCard = written.filter((entry) => entry.uid === uid);
  expect(forCard).toHaveLength(1);
  const url = forCard[0]?.url ?? '';
  expect(url).toMatch(/^https?:\/\/[^/]+\/s\/[A-Za-z0-9_-]{22}$/);
  for (const form of [uid, uid.toLowerCase(), asWebNfc(uid)]) expect(url).not.toContain(form);

  // The same card, read again: Registra spesa of the new customer, with no tap, within 2 s. The
  // reader ignores the same uid within REPEAT_WINDOW_MS (2 s, src/features/card-input/cardReader.ts)
  // of its last read, as a card still held: the next read comes after it, as at the till.
  await page.waitForTimeout(Math.max(0, lastTap + 2500 - Date.now()));
  const started = Date.now();
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  await expect(page).toHaveURL(purchaseUrl, { timeout: 2000 });
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible({ timeout: 2000 });
  expect(Date.now() - started).toBeLessThan(2000);

  // The way from the card to the purchase never writes the card (criterion 14).
  expect(await fakeCardWrites(page)).toEqual(written);
});

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

    // A new card replaces Maria's: its link is written, then her customer page opens with the
    // confirmation.
    await page.goto(`/clienti/${maria.id}/card`);
    await expect(panel).toContainText('Avvicina la card nuova');
    const newCard = freshUid();
    await tapUntilWritten(page, newCard, `/clienti/${maria.id}`);
    await expect(page.getByRole('status')).toHaveText(`Card …${newCard.slice(-4)} associata`);
    // The line under the name names the new card (SPEC-cards, point 6).
    await expect(page.getByText(`Card attiva …${newCard.slice(-4)} · `)).toBeVisible();

    // The old card, read on the home: deactivated, it does not open Registra spesa.
    await page.goto('/');
    await expect(panel).toContainText('Avvicina la card');
    await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(mariaCard));
    // An operator: the notice, no way to reactivate it (SPEC-customers-v2, point 4).
    await expect(panel).toContainText('Card non attiva: chiedi a un amministratore');
    await expect(panel).toContainText(`Era la card di ${maria.name}.`);
    await expect(page).toHaveURL('/');
  });
});

test('Sostituisci card writes the link on the new card: a random token, never the uid (criterion 10)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page);
  const oldCard = freshUid();
  const customer = await customerWithCard(page, 'Maria Link E2E', oldCard);

  await page.goto(`/clienti/${customer.id}/modifica`);
  await page
    .getByRole('region', { name: 'CARD' })
    .getByRole('link', { name: 'Sostituisci card' })
    .click();
  await expect(page).toHaveURL(`/clienti/${customer.id}/card`);
  await expect(page.getByRole('region', { name: 'Lettura card' })).toContainText(
    'Avvicina la card nuova',
  );

  const newCard = freshUid();
  await tapUntilWritten(page, newCard, `/clienti/${customer.id}`);
  await expect(page.getByRole('status')).toHaveText(`Card …${newCard.slice(-4)} associata`);
  await expect(page.getByText(`Card attiva …${newCard.slice(-4)} · `)).toBeVisible();

  const written = (await fakeCardWrites(page)).filter((entry) => entry.uid === newCard);
  expect(written).toHaveLength(1);
  const url = written[0]?.url ?? '';
  expect(url).toMatch(/^https?:\/\/[^/]+\/s\/[A-Za-z0-9_-]{22}$/);
  for (const form of [newCard, newCard.toLowerCase(), asWebNfc(newCard)]) {
    expect(url).not.toContain(form);
  }
  // Nothing was written on the old card.
  expect((await fakeCardWrites(page)).filter((entry) => entry.uid === oldCard)).toEqual([]);
});

test('a phone that does not write: the association is saved, «Link non scritto», nothing written (criterion 13)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page);
  const customer = await customerWithCard(page, 'Maria Senza Link E2E', freshUid());

  await page.goto(`/clienti/${customer.id}/card`);
  await expect(page.getByRole('region', { name: 'Lettura card' })).toContainText(
    'Avvicina la card nuova',
  );
  await page.evaluate(() => window.__enjoyFakeCardControl?.setCanWrite(false));
  const newCard = freshUid();
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(newCard));

  await expect(page).toHaveURL(`/clienti/${customer.id}`);
  await expect(page.getByRole('status')).toHaveText(
    `Card …${newCard.slice(-4)} associata. Link non scritto.`,
  );
  await expect(page.getByText(`Card attiva …${newCard.slice(-4)} · `)).toBeVisible();
  expect((await fakeCardWrites(page)).filter((entry) => entry.uid === newCard)).toEqual([]);
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
  await expect(panel).toContainText('Card non attiva: chiedi a un amministratore');
  await expect(page).toHaveURL('/');
});

test('an administrator reading a deactivated card on the home lands on «Card non attiva», by the card id (SPEC-customers-v2, criterion 8)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page, seedAccounts.admin.email);
  const uid = freshUid();
  const customer = await customerWithCard(page, 'Maria Admin Disattiva E2E', uid);

  await page.goto(`/clienti/${customer.id}/modifica`);
  const section = page.getByRole('region', { name: 'CARD' });
  await section.getByRole('button', { name: 'Disattiva card' }).click();
  const dialog = page.getByRole('dialog', { name: `Disattivare la card …${uid.slice(-4)}?` });
  await dialog.getByRole('button', { name: 'Disattiva card' }).click();
  await expect(section).toContainText('Nessuna card attiva');

  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Lettura card' });
  await expect(panel).toContainText('Avvicina la card');
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  await expect(page).toHaveURL(/\/card\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Card non attiva' })).toBeVisible();
  expect(page.url()).not.toContain(uid);
  await expect(page.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/');
});

for (const width of [390, 360]) {
  test(`Modifica cliente at ${width}px: «Sostituisci card» and «Disattiva card» side by side, one line each (wireframe)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await stubWebNfc(page);
    await signIn(page);
    const customer = await customerWithCard(page, `Maria Una Riga ${width} E2E`, freshUid());

    await page.goto(`/clienti/${customer.id}/modifica`);
    const section = page.getByRole('region', { name: 'CARD' });
    const replace = section.getByRole('link', { name: 'Sostituisci card' });
    const deactivate = section.getByRole('button', { name: 'Disattiva card' });
    await expect(replace).toBeVisible();
    const [left, right] = await Promise.all([replace.boundingBox(), deactivate.boundingBox()]);
    // Side by side, as in the wireframe, each a touch target.
    expect(left?.y).toBe(right?.y);
    for (const box of [left, right]) expect(box?.height).toBeGreaterThanOrEqual(48);

    const layouts = await Promise.all(
      [replace, deactivate].map((button) =>
        button.evaluate((element) => {
          // The lines the label takes: the distinct tops of its text's boxes.
          const range = document.createRange();
          range.selectNodeContents(element);
          const tops = [...range.getClientRects()].map((rect) => Math.round(rect.top));
          return {
            label: element.textContent,
            lines: new Set(tops).size,
            // Nor cut: the label fits its button.
            fits: element.scrollWidth <= element.clientWidth,
          };
        }),
      ),
    );
    expect(layouts).toEqual([
      { label: 'Sostituisci card', lines: 1, fits: true },
      { label: 'Disattiva card', lines: 1, fits: true },
    ]);
  });
}

test('a link not written at the till is written later from Modifica cliente (criterion 13)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page);
  const uid = freshUid();
  const label = `…${uid.slice(-4)}`;
  await expect(page.getByRole('region', { name: 'Lettura card' })).toContainText(
    'Avvicina la card',
  );
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  await expect(page).toHaveURL('/clienti/nuovo');
  await expect(page.getByRole('region', { name: 'Card letta' })).toContainText(`Codice ${uid}:`);
  await page.getByRole('textbox', { name: 'Nome e cognome' }).fill(uniqueName('Maria Dopo E2E'));
  await page.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ }).check();
  // The card moves away while the link is written.
  await page.evaluate(() => window.__enjoyFakeCardControl?.failNextWrite('io'));
  await page.getByRole('button', { name: 'Salva cliente' }).click();

  // When the form took longer than the card stays in the field, the write asks for it again.
  const writer = page.getByRole('region', { name: 'Scrittura del link' });
  const failure = page.getByRole('alert').filter({ hasText: 'Link non scritto' });
  await expect(async () => {
    if (await writer.getByText(`Avvicina la card ${label}`).isVisible()) {
      await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
    }
    await expect(failure).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Più tardi' }).click();
  await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}\/spesa$/);
  const id = /\/clienti\/([0-9a-f-]{36})\/spesa$/.exec(page.url())?.[1] ?? '';
  expect((await fakeCardWrites(page)).filter((entry) => entry.uid === uid)).toEqual([]);

  await page.goto(`/clienti/${id}/modifica`);
  const section = page.getByRole('region', { name: 'CARD' });
  await expect(section).toContainText(
    'Link non scritto: il cliente non può ancora vedere i suoi punti con la card.',
  );
  const write = section.getByRole('button', { name: 'Scrivi il link' });
  expect((await write.boundingBox())?.height).toBeGreaterThanOrEqual(48);
  await write.click();
  await expect(section.getByRole('region', { name: 'Scrittura del link' })).toContainText(
    `Avvicina la card ${label}`,
  );

  // The card is put back on the phone: the link is written, verified and confirmed.
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  await expect(section).toContainText('Link ai punti scritto');
  await expect(section.getByRole('region', { name: 'Scrittura del link' })).toBeHidden();
  await expect(section.getByRole('button', { name: 'Scrivi di nuovo il link' })).toBeVisible();

  const written = (await fakeCardWrites(page)).filter((entry) => entry.uid === uid);
  expect(written).toHaveLength(1);
  expect(written[0]?.url).toMatch(/^https?:\/\/[^/]+\/s\/[A-Za-z0-9_-]{22}$/);
});
