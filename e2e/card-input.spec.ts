import { signIn } from './auth';
import { expect, homeSearch, test } from './fixtures';
import { fakeCardErasures, fakeCardWrites, stubWebNfc } from './nfc';

/**
 * Card reading end to end (docs/specs/SPEC-card-input.md, Testing Strategy). Web NFC does not exist
 * in Playwright: the E2E build (VITE_E2E=1) installs the fake reader instead.
 */

test('the E2E build exposes the fake card reader once an operator is signed in', async ({
  page,
}) => {
  await signIn(page);
  expect(await page.evaluate(() => typeof window.__enjoyFakeCard)).toBe('function');
  // A read reaches the home without errors (the fixture fails on console errors).
  await page.evaluate(() => window.__enjoyFakeCard?.('04A1B2C3D4E5F6'));
});

test('the E2E build exposes the fake writer: an empty write log and the test controls', async ({
  page,
}) => {
  await signIn(page);
  expect(await page.evaluate(() => Array.isArray(window.__enjoyFakeCardWrites))).toBe(true);
  expect(
    await page.evaluate(() => [
      typeof window.__enjoyFakeCardControl?.failNextWrite,
      typeof window.__enjoyFakeCardControl?.setCanWrite,
    ]),
  ).toEqual(['function', 'function']);
  expect(await fakeCardWrites(page)).toEqual([]);
  expect(await fakeCardErasures(page)).toEqual([]);
});

const HOME_TITLE = 'Avvicina la card';
const OFF_TEXT =
  'Attiva l’NFC nelle impostazioni del telefono e torna qui. Su iPhone le card non si leggono: cerca il cliente per nome o telefono.';

test.describe('the card panel on the home', () => {
  test('first start: "Attiva la lettura" turns reading on, above the search', async ({ page }) => {
    await stubWebNfc(page, { permission: 'prompt' });
    await signIn(page);
    const panel = page.getByRole('region', { name: 'Lettura card' });
    await expect(panel).toContainText('Lettura delle card');
    await expect(panel).toContainText(
      'Serve una volta sola: il telefono chiede il permesso di usare l’NFC.',
    );
    const field = homeSearch(page, 'full');
    await expect(field).toBeVisible();
    const panelBox = await panel.boundingBox();
    const fieldBox = await field.boundingBox();
    expect(panelBox && fieldBox && panelBox.y + panelBox.height <= fieldBox.y).toBe(true);

    const start = panel.getByRole('button', { name: 'Attiva la lettura' });
    expect((await start.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    await start.click();
    await expect(panel).toContainText(HOME_TITLE);
    await expect(panel.getByRole('button')).toHaveCount(0);
  });

  test('NFC off: "Lettura card spenta" with "Riprova la lettura", and the search still works', async ({
    page,
  }) => {
    await stubWebNfc(page, { permission: 'granted', scan: 'NotReadableError' });
    await signIn(page);
    const panel = page.getByRole('region', { name: 'Lettura card' });
    await expect(panel).toContainText('Lettura card spenta');
    await expect(panel).toContainText(OFF_TEXT);
    const retry = panel.getByRole('button', { name: 'Riprova la lettura' });
    await expect(retry).toBeVisible();
    expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(48);

    // A seed customer (supabase/seed.sql) is found by name.
    await homeSearch(page, 'full').fill('bianchi');
    await expect(
      page.getByRole('list', { name: 'Risultati della ricerca' }).getByRole('link', {
        name: /^Giulia Bianchi\b/,
      }),
    ).toBeVisible();
    // With reading off the compact line has nothing to say.
    await expect(page.getByRole('region', { name: 'Lettura card' })).toHaveCount(0);
  });

  test('iPhone (no NDEFReader): reading off without a button, and the search still works', async ({
    page,
  }) => {
    await stubWebNfc(page, { supported: false });
    await signIn(page);
    const panel = page.getByRole('region', { name: 'Lettura card' });
    await expect(panel).toContainText('Lettura card spenta');
    await expect(panel).toContainText(OFF_TEXT);
    await expect(panel.getByRole('button')).toHaveCount(0);
    await homeSearch(page, 'full').fill('bianchi');
    await expect(page.getByRole('list', { name: 'Risultati della ricerca' })).toBeVisible();
  });

  test('a search shrinks the panel to one line, and clearing it brings the panel back', async ({
    page,
  }) => {
    await stubWebNfc(page);
    await signIn(page);
    const panel = page.getByRole('region', { name: 'Lettura card' });
    await expect(panel).toContainText(HOME_TITLE);
    await homeSearch(page, 'full').fill('zzzz');
    await expect(page.getByRole('heading', { name: 'Nessun cliente trovato' })).toBeVisible();
    await expect(panel).toHaveText('Lettura attiva: puoi anche avvicinare la card');
    await expect(homeSearch(page, 'compact')).toBeVisible();
    await page.getByRole('button', { name: 'Cancella la ricerca' }).click();
    await expect(panel).toContainText(HOME_TITLE);
  });
});

test.describe('the USB reader on the home (keyboard wedge, format hex)', () => {
  test('a burst closed by Enter is a read: the focused "Nuovo cliente" is not followed', async ({
    page,
  }) => {
    await stubWebNfc(page);
    await signIn(page);
    const newCustomer = page.getByRole('link', { name: 'Nuovo cliente' });
    await newCustomer.focus();
    await page.keyboard.type('04A1B2C3D4E5F6', { delay: 0 });
    await page.keyboard.press('Enter');
    // Enter stopped by the wedge: the burst is a read, which the home hands to `cards` (an unknown
    // card opens Nuovo cliente with it), and the link was not followed: one step back is the home.
    await expect(page).toHaveURL(/\/clienti\/nuovo\?card=04A1B2C3D4E5F6$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);

    // Control: a plain Enter on the same link does follow it.
    await newCustomer.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/clienti\/nuovo$/);
  });

  test('typing at a human pace in the search stays in the field', async ({ page }) => {
    await stubWebNfc(page);
    await signIn(page);
    const field = homeSearch(page, 'full');
    await field.focus();
    await page.keyboard.type('04A1B2C3', { delay: 120 });
    await page.keyboard.press('Enter');
    await expect(homeSearch(page)).toHaveValue('04A1B2C3');
    await expect(page).toHaveURL(/\/\?q=04A1B2C3$/);
  });
});
