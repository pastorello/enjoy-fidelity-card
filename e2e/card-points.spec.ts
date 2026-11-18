import type { Browser, Page, Request } from '@playwright/test';
import { signIn } from './auth';
import { expect, test } from './fixtures';
import {
  asWebNfc,
  customerWithCard,
  fakeCardWrites,
  freshUid,
  stubWebNfc,
  tapUntilWritten,
} from './nfc';

/**
 * The customer's points page behind the link on the card (docs/specs/SPEC-cards.md, point 9 and
 * Testing Strategy), opened as the customer's phone would: a browser context with no account. Its
 * headers (`Cache-Control: no-store`, `X-Robots-Tag`) exist only on Vercel: scripts/vercelHeaders.test.ts.
 */

const SUPABASE_PORT = '54321';

/** The local Supabase API, under either of its names. */
function isSupabase(request: Request): boolean {
  return new URL(request.url()).port === SUPABASE_PORT;
}

/**
 * The link written on the card names the preview over https (playwright.config.ts): the same page
 * over the http the preview serves.
 */
function openable(link: string): string {
  return link.replace(/^https:/, 'http:');
}

function tokenOf(link: string): string {
  const token = /\/s\/([A-Za-z0-9_-]{22})$/.exec(link)?.[1];
  if (token === undefined) throw new Error(`Not a card link: ${link}`);
  return token;
}

/** A token of the right shape that no card has ever had. */
function inventedToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString('base64url');
}

type Visit = { page: Page; requests: Request[]; errors: string[]; close: () => Promise<void> };

/**
 * Opens `url` in a new browser context, phone-sized, with no session and no storage: the customer's
 * phone. Records every request and every console error or warning of that page.
 */
async function openAsCustomer(browser: Browser, url: string): Promise<Visit> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const requests: Request[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  return { page, requests, errors, close: () => context.close() };
}

/** The whole text of the page, spaces collapsed. */
async function pageText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
}

/**
 * What the public page may do with the network and the browser (SPEC-cards, Security): one POST to
 * `rpc/card_points` per load, the token never in a request URL or referrer besides the page's own,
 * and no service worker.
 */
async function expectOnlyCardPoints(visit: Visit, token: string) {
  const { page, requests } = visit;
  await page.waitForLoadState('load');

  const supabase = requests.filter(isSupabase);
  expect(supabase.length).toBeGreaterThan(0);
  for (const request of supabase) {
    expect({ method: request.method(), path: new URL(request.url()).pathname }).toEqual({
      method: 'POST',
      path: '/rest/v1/rpc/card_points',
    });
  }

  const others = requests.filter((request) => request.url() !== page.url());
  const sent = await Promise.all(
    others.map(async (request) => ({
      url: request.url(),
      referer: (await request.allHeaders())['referer'] ?? '',
    })),
  );
  for (const { url, referer } of sent) {
    expect(url).not.toContain(token);
    expect(referer).not.toContain(token);
  }

  // The worker would be registered on `load` (src/app/registerServiceWorker.ts): none on /s/….
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toHaveLength(0);
  expect(page.context().serviceWorkers()).toEqual([]);
  expect(visit.errors, 'console errors on the public page').toEqual([]);
}

test('the link written on a new card shows «ENJOY YOUR POINTS» and 0 without an account, and nothing else (criterion 10)', async ({
  page,
  browser,
}) => {
  await stubWebNfc(page);
  await signIn(page);
  const uid = freshUid();
  const customer = await customerWithCard(page, 'Card Punti E2E', uid);

  const written = (await fakeCardWrites(page)).filter((entry) => entry.uid === uid);
  expect(written).toHaveLength(1);
  const link = written[0]?.url ?? '';
  const token = tokenOf(link);

  const visit = await openAsCustomer(browser, openable(link));
  try {
    const { page: customerPage } = visit;
    await expect(
      customerPage.getByRole('heading', { level: 1, name: 'ENJOY YOUR POINTS' }),
    ).toBeVisible();
    const panel = customerPage.getByRole('region', { name: 'ENJOY YOUR POINTS' });
    await expect(panel.getByText('0', { exact: true })).toBeVisible();
    await expect(panel.getByText('punti', { exact: true })).toBeVisible();

    // Only the board's text: no name, no other data, no way into the operators' screens.
    const text = await pageText(customerPage);
    expect(text).not.toContain(customer.name);
    expect(text).not.toContain(customer.name.split(' ')[0] ?? customer.name);
    expect(text).not.toContain(uid.slice(-4));
    expect(text).toBe(
      'ENJOY YOUR POINTS 0 punti Mostra la card alla cassa per usare i tuoi punti. ' +
        'Questa pagina mostra solo i punti della card, senza dati personali. Enjoy Bar · Gaeta',
    );
    await expect(customerPage.getByRole('link')).toHaveCount(0);
    await expect(customerPage).not.toHaveTitle(new RegExp(token));

    await expectOnlyCardPoints(visit, token);
  } finally {
    await visit.close();
  }
});

test('Sostituisci card: the old link shows «Card non attiva», the new one the points (criterion 11)', async ({
  page,
  browser,
}) => {
  await stubWebNfc(page);
  await signIn(page);
  const oldCard = freshUid();
  const customer = await customerWithCard(page, 'Card Vecchio Link E2E', oldCard);
  const oldLink = (await fakeCardWrites(page)).find((entry) => entry.uid === oldCard)?.url ?? '';
  tokenOf(oldLink);

  await page.goto(`/clienti/${customer.id}/card`);
  await expect(page.getByRole('region', { name: 'Lettura card' })).toContainText(
    'Avvicina la card nuova',
  );
  const newCard = freshUid();
  await tapUntilWritten(page, newCard, `/clienti/${customer.id}`);
  await expect(page.getByRole('status')).toHaveText(`Card …${newCard.slice(-4)} associata`);
  const newLink = (await fakeCardWrites(page)).find((entry) => entry.uid === newCard)?.url ?? '';
  expect(newLink).not.toBe(oldLink);

  const old = await openAsCustomer(browser, openable(oldLink));
  try {
    await expect(
      old.page.getByRole('heading', { level: 1, name: 'Card non attiva' }),
    ).toBeVisible();
    await expect(old.page.getByText('Questa card non mostra punti. Chiedi al bar.')).toBeVisible();
    await expect(old.page.getByText('ENJOY YOUR POINTS')).toHaveCount(0);
    expect(await pageText(old.page)).not.toContain(customer.name);
    await expectOnlyCardPoints(old, tokenOf(oldLink));
  } finally {
    await old.close();
  }

  const current = await openAsCustomer(browser, openable(newLink));
  try {
    await expect(
      current.page.getByRole('heading', { level: 1, name: 'ENJOY YOUR POINTS' }),
    ).toBeVisible();
    const panel = current.page.getByRole('region', { name: 'ENJOY YOUR POINTS' });
    await expect(panel.getByText('0', { exact: true })).toBeVisible();
    expect(await pageText(current.page)).not.toContain(customer.name);
    await expectOnlyCardPoints(current, tokenOf(newLink));
  } finally {
    await current.close();
  }
});

test('an invented token shows the same neutral «Card non attiva», without saying whether it existed (criterion 11)', async ({
  browser,
  baseURL,
}) => {
  const token = inventedToken();
  const visit = await openAsCustomer(browser, `${baseURL ?? ''}/s/${token}`);
  try {
    const { page } = visit;
    await expect(page.getByRole('heading', { level: 1, name: 'Card non attiva' })).toBeVisible();
    await expect(page.getByText('Questa card non mostra punti. Chiedi al bar.')).toBeVisible();
    expect(await pageText(page)).toBe(
      'Card non attiva Questa card non mostra punti. Chiedi al bar. Enjoy Bar · Gaeta',
    );
    await expect(page.getByRole('button')).toHaveCount(0);
    await expectOnlyCardPoints(visit, token);
  } finally {
    await visit.close();
  }
});

test('a known card read on the home opens Registra spesa without writing the card or issuing a link (criteria 1, 14)', async ({
  page,
}) => {
  await stubWebNfc(page);
  await signIn(page);
  const uid = freshUid();
  const customer = await customerWithCard(page, 'Card Nota E2E', uid);

  const issued: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/rpc/issue_card_link')) {
      issued.push(request.url());
    }
  });

  // A new page load: the write log of the fake writer starts empty.
  await page.goto('/');
  expect(await fakeCardWrites(page)).toEqual([]);
  const panel = page.getByRole('region', { name: 'Lettura card' });
  await expect(panel).toContainText('Avvicina la card');
  // The reader ignores the same uid within 2 s of its last read (REPEAT_WINDOW_MS): a fresh page
  // starts a fresh reader, so the card is read at once.
  await page.evaluate((read) => window.__enjoyFakeCard?.(read), asWebNfc(uid));
  await expect(page).toHaveURL(`/clienti/${customer.id}/spesa`);
  await expect(page.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(customer.name) })).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(await fakeCardWrites(page)).toEqual([]);
  expect(issued).toEqual([]);
});
