import type { Page, Request } from '@playwright/test';
import { LOCAL_SUPABASE_URL, seedAccounts, signIn, signedInApi } from './auth';
import { runSql } from './db';
import { expect, test } from './fixtures';
import {
  asWebNfc,
  customerWithCard,
  fakeCardErasures,
  fakeCardWrites,
  freshUid,
  stubWebNfc,
  tapUntilWritten,
  tapWhileAsked,
  uniqueName,
  writeAfterSave,
} from './nfc';

/**
 * «Card non attiva» on the phone end to end (docs/specs/SPEC-customers-v2.md, points 4 and 5;
 * criteria 8, 9, 10, 11 and 13), at 390×844 against the local stack. Web NFC does not exist in
 * Playwright: the E2E build reads cards from `window.__enjoyFakeCard` and keeps what it writes in
 * `window.__enjoyFakeCardWrites` (`url: null` for an erased card).
 */

/** The reader ignores the same uid for 2 s (REPEAT_WINDOW_MS): the next read comes after it. */
const REPEAT_WINDOW_MS = 2500;

/** Puts `uid` on the phone, once the reader takes the same card again after `lastTap`. */
async function readAfterRepeatWindow(page: Page, uid: string, lastTap: number) {
  await page.waitForTimeout(Math.max(0, lastTap + REPEAT_WINDOW_MS - Date.now()));
  const read = Date.now();
  await page.evaluate((value) => window.__enjoyFakeCard?.(value), asWebNfc(uid));
  return read;
}

/** The home, reading cards. */
async function home(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Lettura card' })).toContainText(
    'Avvicina la card',
  );
}

/** Types an amount on the app's keypad, digit by digit, as on a POS. */
async function typeAmount(page: Page, digits: string) {
  const keypad = page.getByRole('group', { name: 'Tastierino numerico' });
  await digits
    .split('')
    .reduce(
      (typed, digit) =>
        typed.then(() => keypad.getByRole('button', { name: digit, exact: true }).click()),
      Promise.resolve(),
    );
}

/**
 * A customer whose first card was replaced from Associa card: the first card deactivated, the
 * second active. Returns the customer, both uids, the id of the deactivated card's row and when a
 * card was last tapped.
 */
async function customerWithReplacedCard(page: Page, prefix: string) {
  const lost = freshUid();
  const current = freshUid();
  const customer = await customerWithCard(page, prefix, lost);
  // The write log lives in the page: read before leaving it.
  const lostLink = (await fakeCardWrites(page)).find((entry) => entry.uid === lost)?.url ?? null;
  await page.goto(`/clienti/${customer.id}/card`);
  await expect(page.getByRole('region', { name: 'Lettura card' })).toContainText(
    'Avvicina la card nuova',
  );
  await tapUntilWritten(page, current, `/clienti/${customer.id}`);
  const lostId = runSql(
    `select id from app.cards where uid = :'uid' and not active and released_at is null;`,
    { uid: lost },
  );
  expect(lostId).toMatch(/^[0-9a-f-]{36}$/);
  return { customer, lost, current, lostId, lostLink, lastTap: Date.now() };
}

/** The customer's balance on the server: the sum of the points of every movement. */
function balanceOf(customerId: string): string {
  return runSql(
    `select coalesce(sum(points), 0) from app.movements where customer_id = :'id'::uuid;`,
    { id: customerId },
  );
}

/** The REST calls of the page to the local Supabase, as `METHOD path`, from now on. */
function recordCalls(page: Page): { calls: string[]; stop: () => void } {
  const calls: string[] = [];
  const listener = (request: Request) => {
    const url = new URL(request.url());
    if (url.origin === LOCAL_SUPABASE_URL && url.pathname.startsWith('/rest/')) {
      calls.push(`${request.method()} ${url.pathname}`);
    }
  };
  page.on('request', listener);
  return { calls, stop: () => page.off('request', listener) };
}

/**
 * The calls from an active card read on the home to Registra spesa on screen (criterion 13): the
 * lookup of the card, then the customer the purchase page loads. The same as before customers-v2
 * (main: `useHomeCardRead` looks up and navigates; no `get_card` on this path).
 */
const EXPECTED_PURCHASE_CALLS = ['POST /rest/v1/rpc/lookup_card', 'POST /rest/v1/rpc/get_customer'];

test('an administrator reactivates a lost card in place of the active one: swap, new link, then a purchase in less than 10 s with no extra call (criteria 8, 13)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page, seedAccounts.admin.email);
  const { customer, lost, current, lostId, lostLink } = await customerWithReplacedCard(
    page,
    'Maria Scambia E2E',
  );
  const lostLabel = `…${lost.slice(-4)}`;
  const currentLabel = `…${current.slice(-4)}`;
  expect(lostLink).not.toBeNull();

  // The lost card, back at the till: «Card non attiva», by the id of its row, never the uid.
  await home(page);
  const read = Date.now();
  await page.evaluate((value) => window.__enjoyFakeCard?.(value), asWebNfc(lost));
  await expect(page).toHaveURL(`/card/${lostId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Card non attiva' })).toBeVisible();
  await expect(
    page.getByText(
      `La card torna a Maria al posto della card ${currentLabel}, che si disattiva. I punti restano a Maria.`,
    ),
  ).toBeVisible();
  const reactivate = page.getByRole('button', { name: 'Riattiva la card' });
  const reformat = page.getByRole('button', { name: 'Riformatta la card' });
  for (const box of await Promise.all([reactivate.boundingBox(), reformat.boundingBox()])) {
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }

  // Always asked first; «Lascia com'è» changes nothing.
  await reactivate.click();
  const dialog = page.getByRole('dialog', { name: 'Scambiare le card di Maria?' });
  await expect(dialog).toContainText(`La card ${lostLabel} (disattivata il `);
  await expect(dialog).toContainText(
    `Riattiva solo se la card è tornata a Maria: chi la usa potrà spendere i suoi punti. La card ${currentLabel}, ora attiva, si disattiva e il suo link non mostrerà più i punti. I punti restano a Maria.`,
  );
  await dialog.getByRole('button', { name: 'Lascia com’è' }).click();
  await expect(dialog).toBeHidden();
  expect(runSql(`select active from app.cards where id = :'id'::uuid;`, { id: lostId })).toBe('f');

  await reactivate.click();
  // The card is no longer on the phone (IN_FIELD_MS): the write asks for it, as at the till.
  await page.waitForTimeout(Math.max(0, read + 1600 - Date.now()));
  await dialog.getByRole('button', { name: 'Scambia le card' }).click();

  // Reactivated: the new link is written on the card, then the customer page says so.
  await expect(page.getByRole('status').first()).toContainText(
    `Card ${lostLabel} riattivata per Maria`,
  );
  const lastTap =
    (await tapWhileAsked(page, lost, 'Scrittura del link', () =>
      expect(page).toHaveURL(`/clienti/${customer.id}`, { timeout: 1000 }),
    )) ?? Date.now();
  await expect(page.getByRole('status')).toHaveText(`Card ${lostLabel} riattivata`);
  await expect(page.getByText(`Card attiva ${lostLabel} · `)).toBeVisible();

  // A new link: a random token, never the uid, not the dead one.
  const written = (await fakeCardWrites(page)).filter((entry) => entry.uid === lost);
  expect(written).toHaveLength(1);
  const newLink = written[0]?.url ?? '';
  expect(newLink).toMatch(/^https?:\/\/[^/]+\/s\/[A-Za-z0-9_-]{22}$/);
  expect(newLink).not.toBe(lostLink);
  for (const form of [lost, lost.toLowerCase(), asWebNfc(lost)])
    expect(newLink).not.toContain(form);

  // One active card for the customer: the swapped one is off, without a link; the points stay.
  expect(
    runSql(
      `select c.uid || '|' || c.active || '|' || (l.card_id is not null)
       from app.cards c left join private.card_links l on l.card_id = c.id
       where c.customer_id = :'id'::uuid order by c.uid = :'lost' desc;`,
      { id: customer.id, lost },
    ),
  ).toBe(`${lost}|true|true\n${current}|false|false`);

  // The card back at the till: Registra spesa, and the purchase in less than 10 s from the card,
  // with the same calls as any active card (criterion 13): the lookup, then the purchase page.
  await home(page);
  const recording = recordCalls(page);
  const started = await readAfterRepeatWindow(page, lost, lastTap);
  await expect(page).toHaveURL(`/clienti/${customer.id}/spesa`);
  await expect(page.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeVisible();
  await expect(page.getByText(/nuovo saldo 0 punti/)).toBeVisible();
  recording.stop();
  expect(recording.calls).toEqual(EXPECTED_PURCHASE_CALLS);

  await typeAmount(page, '500');
  await page.getByRole('button', { name: 'Conferma +5' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeVisible();
  expect(Date.now() - started, 'from the card to «Spesa registrata»').toBeLessThan(10_000);
  expect(balanceOf(customer.id)).toBe('5');
});

test('an administrator reactivates a deactivated card with no other card: asked first, then «Riattiva» (criterion 8)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page, seedAccounts.admin.email);
  const uid = freshUid();
  const label = `…${uid.slice(-4)}`;
  const customer = await customerWithCard(page, 'Maria Ritrova E2E', uid);

  await page.goto(`/clienti/${customer.id}/modifica`);
  const section = page.getByRole('region', { name: 'CARD' });
  await section.getByRole('button', { name: 'Disattiva card' }).click();
  await page
    .getByRole('dialog', { name: `Disattivare la card ${label}?` })
    .getByRole('button', { name: 'Disattiva card' })
    .click();
  await expect(section).toContainText('Nessuna card attiva');

  await home(page);
  const read = Date.now();
  await page.evaluate((value) => window.__enjoyFakeCard?.(value), asWebNfc(uid));
  await expect(page).toHaveURL(/\/card\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Riattiva la card' }).click();
  const dialog = page.getByRole('dialog', { name: `Riattivare la card ${label}?` });
  await expect(dialog).toContainText(
    'Riattiva solo se la card è tornata a Maria: chi la usa potrà spendere i suoi punti.',
  );
  await expect(dialog).toContainText(/Disattivata il \d{1,2} \w{3}\./);
  // The card is no longer on the phone (IN_FIELD_MS): the write waits for it.
  await page.waitForTimeout(Math.max(0, read + 1600 - Date.now()));
  await dialog.getByRole('button', { name: 'Riattiva', exact: true }).click();

  // «Salta, lo scrivo più tardi»: reactivated all the same, the link not written.
  await expect(page.getByRole('status').first()).toContainText(
    `Card ${label} riattivata per Maria`,
  );
  await page.getByRole('button', { name: 'Salta, lo scrivo più tardi' }).click();
  await expect(page).toHaveURL(`/clienti/${customer.id}`);
  await expect(page.getByRole('status')).toHaveText(`Card ${label} riattivata. Link non scritto.`);
  await expect(page.getByText(`Card attiva ${label} · `)).toBeVisible();
  expect(
    runSql(`select count(*) from app.cards where customer_id = :'id'::uuid and active;`, {
      id: customer.id,
    }),
  ).toBe('1');
});

test.describe('Riformatta', () => {
  // The first release_card is cut off by the test (the network drops): the browser logs it.
  test.use({ expectedRefusals: [/\/rest\/v1\/rpc\/release_card$/] });

  test('an administrator reformats a lost card: erased and verified, then freed for good (the network drops once: same operation); read again, it is a new customer’s (criterion 9)', async ({
    page,
  }) => {
    await stubWebNfc(page);
    await signIn(page, seedAccounts.admin.email);
    const { customer, lost, current, lostId } = await customerWithReplacedCard(
      page,
      'Maria Riformatta E2E',
    );
    const label = `…${lost.slice(-4)}`;

    // A purchase with the active card: the points that must stay to Maria.
    await home(page);
    await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(current));
    await expect(page).toHaveURL(`/clienti/${customer.id}/spesa`);
    await typeAmount(page, '700');
    await page.getByRole('button', { name: 'Conferma +7' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeVisible();
    const movements = runSql(
      `select count(*) from app.movements where customer_id = :'id'::uuid;`,
      { id: customer.id },
    );
    expect(balanceOf(customer.id)).toBe('7');

    await home(page);
    await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(lost));
    await expect(page).toHaveURL(`/card/${lostId}`);
    await page.getByRole('button', { name: 'Riformatta la card' }).click();
    const dialog = page.getByRole('dialog', { name: `Riformattare la card ${label}?` });
    await expect(dialog).toContainText('La card si svuota e non sarà più di Maria Riformatta E2E');
    await expect(dialog).toContainText('Punti e movimenti restano a Maria.');
    await expect(dialog).toContainText('Non si può tornare indietro.');

    // The first release does not reach the server, after the card was erased.
    const releases: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/rest/v1/rpc/release_card')) {
        const body: unknown = request.postDataJSON();
        const id = typeof body === 'object' && body !== null && 'p_operation_id' in body;
        releases.push(id ? String(body.p_operation_id) : '');
      }
    });
    let cut = false;
    await page.route('**/rest/v1/rpc/release_card', async (route) => {
      if (cut) return route.continue();
      cut = true;
      return route.abort('failed');
    });
    await dialog.getByRole('button', { name: 'Riformatta', exact: true }).click();

    const failure = page
      .getByRole('alert')
      .filter({ hasText: 'Card svuotata ma non liberata: controlla la connessione.' });
    const lastTap =
      (await tapWhileAsked(page, lost, 'Riformattazione della card', () =>
        expect(failure).toBeVisible({ timeout: 1000 }),
      )) ?? Date.now();
    // Erased once: one empty record, written and verified before any release.
    expect(await fakeCardErasures(page, lost)).toHaveLength(1);
    expect(
      runSql(`select released_at is null from app.cards where id = :'id'::uuid;`, { id: lostId }),
    ).toBe('t');

    // «Riprova» sends the release again, with the same operation, without the card.
    const retry = page.getByRole('button', { name: 'Riprova' });
    expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    await retry.click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText(`Card ${label} riformattata: ora è libera.`)).toBeVisible();
    expect(releases).toHaveLength(2);
    expect(releases[1]).toBe(releases[0]);
    expect(await fakeCardErasures(page, lost)).toHaveLength(1);

    // Freed for good: the row kept, with the operation; no link; Maria's points and movements as
    // they were, her active card untouched.
    expect(
      runSql(
        `select c.customer_id || '|' || c.active || '|' || c.release_operation_id || '|' ||
           (select count(*) from private.card_links l where l.card_id = c.id)
         from app.cards c where c.id = :'id'::uuid and c.released_at is not null;`,
        { id: lostId },
      ),
    ).toBe(`${customer.id}|false|${releases[0]}|0`);
    expect(balanceOf(customer.id)).toBe('7');
    expect(
      runSql(`select count(*) from app.movements where customer_id = :'id'::uuid;`, {
        id: customer.id,
      }),
    ).toBe(movements);
    expect(
      runSql(`select uid from app.cards where customer_id = :'id'::uuid and active;`, {
        id: customer.id,
      }),
    ).toBe(current);

    // The same card read again on the home: Nuovo cliente with it, then a new customer's card.
    await readAfterRepeatWindow(page, lost, lastTap);
    await expect(page).toHaveURL('/clienti/nuovo');
    await expect(page.getByRole('region', { name: 'Card letta' })).toContainText(
      `Codice ${lost}: non è di nessun cliente, verrà associata a questo.`,
    );
    const name = uniqueName('Antonio Card Libera E2E');
    await page.getByRole('textbox', { name: 'Nome e cognome' }).fill(name);
    await page.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ }).check();
    await page.getByRole('button', { name: 'Salva cliente' }).click();
    await writeAfterSave(page, lost, /\/clienti\/[0-9a-f-]{36}\/spesa$/);
    const newCustomer = /\/clienti\/([0-9a-f-]{36})\/spesa$/.exec(page.url())?.[1] ?? '';
    expect(
      runSql(
        `select customer_id || '|' || active || '|' || (released_at is not null)
         from app.cards where uid = :'uid' order by released_at nulls first;`,
        { uid: lost },
      ),
    ).toBe(`${newCustomer}|true|false\n${customer.id}|false|true`);
  });
});

test('the card of an erased customer offers only Riformatta, with the same outcome (criterion 10)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page, seedAccounts.admin.email);
  const uid = freshUid();
  const label = `…${uid.slice(-4)}`;
  const customer = await customerWithCard(page, 'Maria Cancellata E2E', uid);

  await page.goto(`/clienti/${customer.id}/modifica`);
  await page.getByRole('button', { name: 'Cancella i dati del cliente' }).click();
  await page
    .getByRole('dialog', { name: `Cancellare i dati di ${customer.name}?` })
    .getByRole('button', { name: 'Cancella i dati' })
    .click();
  await expect(page.getByText('Dati del cliente cancellati.')).toBeVisible();
  const cardId = runSql(`select id from app.cards where uid = :'uid';`, { uid });

  await home(page);
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  await expect(page).toHaveURL(`/card/${cardId}`);
  await expect(page.getByText('Era di un cliente i cui dati sono stati cancellati.')).toBeVisible();
  await expect(page.getByText(customer.name)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Riattiva la card' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Riformatta la card' }).click();
  const dialog = page.getByRole('dialog', { name: `Riformattare la card ${label}?` });
  await expect(dialog).toContainText(
    'La card si svuota e torna come nuova. Non si può tornare indietro.',
  );
  await dialog.getByRole('button', { name: 'Riformatta', exact: true }).click();
  const lastTap =
    (await tapWhileAsked(page, uid, 'Riformattazione della card', () =>
      expect(page).toHaveURL('/', { timeout: 1000 }),
    )) ?? Date.now();
  await expect(page.getByText(`Card ${label} riformattata: ora è libera.`)).toBeVisible();
  expect(await fakeCardErasures(page, uid)).toHaveLength(1);
  expect(
    runSql(`select released_at is not null from app.cards where id = :'id'::uuid;`, {
      id: cardId,
    }),
  ).toBe('t');

  // Free: read again, it opens Nuovo cliente with the card.
  await readAfterRepeatWindow(page, uid, lastTap);
  await expect(page).toHaveURL('/clienti/nuovo');
  await expect(page.getByRole('region', { name: 'Card letta' })).toContainText(
    `Codice ${uid}: non è di nessun cliente, verrà associata a questo.`,
  );
});

test.describe('an operator', () => {
  // Associa card: the reactivation is refused by the server with a 400 (forbidden), shown on the page.
  test.use({ expectedRefusals: [/\/rest\/v1\/rpc\/associate_card$/] });

  test('cannot reactivate nor reformat a deactivated card: the notice on the home, the page refused, Associa card refused, the RPCs forbidden (criterion 11)', async ({
    page,
    request,
  }) => {
    await stubWebNfc(page);
    await signIn(page);
    const { customer, lost, current, lostId, lastTap } = await customerWithReplacedCard(
      page,
      'Maria Operatore E2E',
    );
    const panel = page.getByRole('region', { name: 'Lettura card' });

    // On the home: the notice, reading stays on, no «Card non attiva» page.
    await home(page);
    const calls = recordCalls(page);
    await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(lost));
    await expect(panel).toContainText('Card non attiva: chiedi a un amministratore');
    await expect(page).toHaveURL('/');

    // The page opened by hand: refused without asking the server for the card.
    await page.goto(`/card/${lostId}`);
    await expect(
      page.getByText('Solo un amministratore può riattivare o riformattare una card.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Riattiva la card' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Riformatta la card' })).toHaveCount(0);
    calls.stop();
    expect(
      calls.calls.filter((call) => /\/rpc\/(get_card|reactivate_card|release_card)$/.test(call)),
    ).toEqual([]);

    // Associa card of the same customer: her lost card is refused with the cards text.
    await page.goto(`/clienti/${customer.id}/card`);
    await expect(panel).toContainText('Avvicina la card nuova');
    await page.waitForTimeout(Math.max(0, lastTap + REPEAT_WINDOW_MS - Date.now()));
    await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(lost));
    await expect(panel).toContainText('Card non attiva: chiedi a un amministratore.');
    await expect(page).toHaveURL(`/clienti/${customer.id}/card`);

    // The server refuses the operator the same, whatever the client.
    const { key, token } = await signedInApi(request, seedAccounts.operator.email);
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Profile': 'app' };
    const answers = await Promise.all(
      (
        [
          ['reactivate_card', { p_card_id: lostId, p_expected_active_card_id: null }],
          ['release_card', { p_operation_id: crypto.randomUUID(), p_card_id: lostId }],
        ] as const
      ).map(async ([fn, data]) => {
        const answer = await request.post(`${LOCAL_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
          headers,
          data,
        });
        const body: unknown = await answer.json();
        return { fn, ok: answer.ok(), body };
      }),
    );
    for (const answer of answers) {
      expect(answer.ok, answer.fn).toBe(false);
      expect(answer.body, answer.fn).toMatchObject({ message: 'forbidden' });
    }

    // Nothing changed: the lost card off and kept, the other one active.
    expect(
      runSql(
        `select uid || '|' || active || '|' || (released_at is not null)
         from app.cards where customer_id = :'id'::uuid order by uid = :'lost' desc;`,
        { id: customer.id, lost },
      ),
    ).toBe(`${lost}|false|false\n${current}|true|false`);
  });
});
