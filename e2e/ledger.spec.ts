import { execFileSync } from 'node:child_process';
import type { APIRequestContext, Page } from '@playwright/test';
import { SEED_PASSWORD, seedAccounts, signIn } from './auth';
import { expect, test } from './fixtures';
import { asWebNfc, customerWithCard, freshUid, stubWebNfc } from './nfc';

/**
 * Registra spesa end to end (docs/specs/SPEC-ledger.md, criteria 3 and 4), against the local
 * stack. Web NFC does not exist in Playwright: the E2E build reads cards from
 * `window.__enjoyFakeCard`. The ratio in force is the initial one (1 punto ogni 1,00 €): the specs
 * that change it run after these (`phone-settings` in playwright.config.ts) and put it back.
 */

/** Same origin as playwright.config.ts (LOCAL_SUPABASE_URL). */
const LOCAL_SUPABASE_URL = 'http://localhost:54321';

/** The reader ignores the same uid for 2 s (REPEAT_WINDOW_MS): the next read comes after it. */
async function readCardAfterRepeatWindow(page: Page, uid: string, lastTap: number) {
  await page.waitForTimeout(Math.max(0, lastTap + 2500 - Date.now()));
  const read = Date.now();
  await page.evaluate((value) => window.__enjoyFakeCard?.(value), asWebNfc(uid));
  return read;
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

/**
 * The customer's movements as the database holds them, read by the operator through the API
 * (`app.movement_history`), outside the page: what the history will show.
 */
async function movementsOf(request: APIRequestContext, customerId: string) {
  const status = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const key = /^PUBLISHABLE_KEY="?([^"\n]+)"?$/m.exec(status)?.[1];
  if (!key) throw new Error('`supabase status` printed no PUBLISHABLE_KEY.');
  const auth = await request.post(`${LOCAL_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: key },
    data: { email: seedAccounts.operator.email, password: SEED_PASSWORD },
  });
  expect(auth.ok()).toBe(true);
  const session: unknown = await auth.json();
  const token =
    typeof session === 'object' && session !== null && 'access_token' in session
      ? session.access_token
      : null;
  if (typeof token !== 'string') throw new Error('Auth gave no access token.');
  const response = await request.get(
    `${LOCAL_SUPABASE_URL}/rest/v1/movement_history?customer_id=eq.${customerId}&select=kind,amount_cents,points,corrects_movement_id`,
    { headers: { apikey: key, Authorization: `Bearer ${token}`, 'Accept-Profile': 'app' } },
  );
  expect(response.ok()).toBe(true);
  // Compared whole with `toEqual`: no shape to trust before that.
  const rows: unknown = await response.json();
  return rows;
}

/** Every button or link named is at least 48 px tall (CLAUDE.md: touch targets). */
async function expectTouchTargets(page: Page, names: (string | RegExp)[]) {
  const boxes = await Promise.all(
    names.map((name) =>
      page.getByRole('button', { name }).or(page.getByRole('link', { name })).boundingBox(),
    ),
  );
  boxes.forEach((box, index) => {
    expect(box?.height, String(names[index])).toBeGreaterThanOrEqual(48);
  });
}

test('from the card to «Spesa registrata» in less than 10 s; after 10 s back to the home, with the customer in Serviti oggi (criterion 3)', async ({
  page,
  request,
}) => {
  await stubWebNfc(page);
  await signIn(page);
  const uid = freshUid();
  const customer = await customerWithCard(page, 'Maria Spesa E2E', uid);

  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Lettura card' });
  await expect(panel).toContainText('Avvicina la card');

  // The card is read on the home: the clock of criterion 3 starts here.
  const started = await readCardAfterRepeatWindow(page, uid, customer.lastTap);
  await expect(page).toHaveURL(`/clienti/${customer.id}/spesa`);
  await expect(page.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeVisible();
  await expect(
    page.getByText('1 punto ogni 1,00 €, per difetto · nuovo saldo 0 punti'),
  ).toBeVisible();

  await typeAmount(page, '1250');
  await expect(page.getByRole('region', { name: 'Importo' }).getByRole('status')).toHaveText(
    '12,50 €',
  );
  await expect(page.getByText('nuovo saldo 12 punti')).toBeVisible();
  await expectTouchTargets(page, ['Doppio zero', 'Cancella ultima cifra', 'Riscatta premio']);
  const confirm = page.getByRole('button', { name: 'Conferma +12' });
  expect((await confirm.boundingBox())?.height).toBeGreaterThanOrEqual(48);
  await confirm.click();

  await expect(page.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeVisible();
  const elapsed = Date.now() - started;
  expect(elapsed, 'from the card to «Spesa registrata»').toBeLessThan(10_000);
  await expect(page.getByText(`+12 punti a ${customer.name}`)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Nuovo saldo' })).toContainText('12');
  await expect(page.getByText(/^12,50\s€ · oggi \d{2}:\d{2} · Operatore Prova$/)).toBeVisible();
  await expectTouchTargets(page, [/^Annulla la spesa · \d+ s$/, 'Leggi un’altra card']);

  // After 10 s the confirmation goes back to reading cards, by itself.
  await expect(page).toHaveURL('/', { timeout: 13_000 });
  await expect(panel).toContainText('Avvicina la card');
  const served = page.getByRole('region', { name: 'SERVITI OGGI' });
  const row = served.getByRole('link', { name: new RegExp(customer.name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('12');
  expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(48);

  // One purchase of 12,50 € and 12 points, with the ratio in force saved on it.
  const movements = await movementsOf(request, customer.id);
  expect(movements).toEqual([
    { kind: 'purchase', amount_cents: 1250, points: 12, corrects_movement_id: null },
  ]);
});

test.describe('Spesa non salvata', () => {
  // Offline, the browser logs the request to record_purchase that could not leave.
  test.use({ expectedRefusals: [/\/rest\/v1\/rpc\/record_purchase$/] });

  test('offline: «Spesa non salvata»; back online, Riprova registers one movement (criterion 4)', async ({
    page,
    context,
    request,
  }) => {
    await stubWebNfc(page);
    await signIn(page);
    const uid = freshUid();
    const customer = await customerWithCard(page, 'Maria Offline E2E', uid);
    await expect(page.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeVisible();

    await typeAmount(page, '1250');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Conferma +12' }).click();

    const alert = page.getByRole('alert').filter({ hasText: 'Spesa non salvata' });
    await expect(alert).toContainText(
      'Il telefono non è connesso a internet. L’importo resta qui: riprova appena torna la rete. La spesa non verrà registrata due volte.',
    );
    // The amount and the preview stay; the keypad gives way to the alert.
    await expect(page.getByRole('region', { name: 'Importo' })).toContainText('12,50 €');
    await expect(page.getByRole('group', { name: 'Tastierino numerico' })).toHaveCount(0);
    await expectTouchTargets(page, ['Annulla', 'Riprova +12']);
    expect(await movementsOf(request, customer.id)).toEqual([]);

    // A second tap while offline fails the same way, and sends nothing twice.
    const retry = page.getByRole('button', { name: 'Riprova +12' });
    await retry.click();
    await expect(alert).toBeVisible();
    await expect(retry).toBeEnabled();

    await context.setOffline(false);
    await retry.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeVisible();
    await expect(page.getByText(`+12 punti a ${customer.name}`)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Nuovo saldo' })).toContainText('12');

    expect(await movementsOf(request, customer.id)).toEqual([
      { kind: 'purchase', amount_cents: 1250, points: 12, corrects_movement_id: null },
    ]);
  });

  test('the answer is lost after the server registered the purchase: Riprova returns it, one movement (criterion 4)', async ({
    page,
    request,
  }) => {
    await stubWebNfc(page);
    await signIn(page);
    const uid = freshUid();
    const customer = await customerWithCard(page, 'Maria Risposta E2E', uid);
    await expect(page.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeVisible();

    // The first request reaches the server, but its answer never comes back to the phone.
    let sent = 0;
    await page.route('**/rest/v1/rpc/record_purchase', async (route) => {
      sent += 1;
      if (sent > 1) return route.continue();
      await route.fetch();
      return route.abort('internetdisconnected');
    });

    await typeAmount(page, '1250');
    await page.getByRole('button', { name: 'Conferma +12' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Spesa non salvata' })).toBeVisible();
    expect(await movementsOf(request, customer.id)).toHaveLength(1);

    await page.getByRole('button', { name: 'Riprova +12' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Nuovo saldo' })).toContainText('12');
    expect(sent).toBe(2);

    expect(await movementsOf(request, customer.id)).toEqual([
      { kind: 'purchase', amount_cents: 1250, points: 12, corrects_movement_id: null },
    ]);
  });
});
