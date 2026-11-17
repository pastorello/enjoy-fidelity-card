import type { Locator, Page } from '@playwright/test';
import { runSql } from '../tests/integration/localSupabase';
import { seedAccounts, signIn } from './auth';
import { expect, test } from './fixtures';

/**
 * Points settings end to end (SPEC-settings). The configuration is one shared row, so these tests
 * change global state: they run in the `phone-settings` project, after every `phone` test, one
 * at a time, and `afterAll` puts back the initial 100 / 15000 as the seed admin would, then the
 * row's `updated_at` / `updated_by` (as the integration suite does), so pgTAP and a second run
 * find the row exactly as after `db:reset`.
 */
test.describe.configure({ mode: 'serial' });

const FINAL_NOTE =
  'Operatori, premi, esportazioni e annullamenti dei movimenti li gestiscono gli amministratori.';

function ratioField(page: Page) {
  return page.getByLabel('1 punto ogni');
}

function thresholdField(page: Page) {
  return page.getByLabel('Chiedi conferma sopra');
}

async function openSettingsAs(page: Page, email: string) {
  await signIn(page, email);
  await page.goto('/impostazioni');
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible();
}

/** Admin save through the page, waiting for the confirmation. */
async function saveSettings(page: Page, ratio: string, threshold: string) {
  await ratioField(page).fill(ratio);
  await thresholdField(page).fill(threshold);
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Impostazioni salvate.')).toBeVisible();
}

async function expectTouchTargets(targets: Locator[]) {
  const boxes = await Promise.all(targets.map((target) => target.boundingBox()));
  boxes.forEach((box, index) => {
    const name = targets[index]?.toString();
    expect(box?.height, `height of ${name}`).toBeGreaterThanOrEqual(48);
    expect(box?.width, `width of ${name}`).toBeGreaterThanOrEqual(48);
  });
}

/** The settings row as stored, read as the database owner (local stack only). */
function storedRow(): string {
  return runSql(
    `select cents_per_point || '/' || confirm_threshold_cents || '/' || usb_uid_format
     from app.settings;`,
  );
}

/** `updated_at` and `updated_by` before this file, as text ('' for null). */
let stamp: { at: string; by: string } | undefined;

test.beforeAll(() => {
  const initial = storedRow();
  if (initial !== '100/15000/hex') {
    throw new Error(`Expected the initial settings, found ${initial}: run \`npm run db:reset\`.`);
  }
  const [at = '', by = ''] = runSql(
    `select updated_at::text || '|' || coalesce(updated_by::text, '') from app.settings;`,
  ).split('|');
  stamp = { at, by };
});

test.afterAll(async ({ browser }, testInfo) => {
  // Even after a failure, leave the initial configuration for the next run.
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: testInfo.project.use.viewport,
  });
  const page = await context.newPage();
  try {
    await openSettingsAs(page, seedAccounts.admin.email);
    await saveSettings(page, '1,00', '150,00');
  } finally {
    await context.close();
    // Who and when back as found, so the row is exactly as after `db:reset` (no stamp: the
    // row was not initial to begin with, and beforeAll already failed saying so).
    if (stamp) {
      runSql(
        `update app.settings
         set updated_at = :'at'::timestamptz, updated_by = nullif(:'by', '')::uuid;`,
        stamp,
      );
    }
  }
  expect(storedRow()).toBe('100/15000/hex');
});

test('an administrator changes the ratio and the threshold, and finds them after a reload', async ({
  page,
}) => {
  await openSettingsAs(page, seedAccounts.admin.email);

  // Wireframe "Impostazioni": account box, PUNTI E CONTROLLI, then ACCOUNT (cross-review §1).
  const sections = page.locator('main > section');
  await expect(sections.first()).toHaveAccessibleName('Account');
  await expect(sections.first()).toContainText(seedAccounts.admin.name);
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
    'PUNTI E CONTROLLI',
    'ACCOUNT',
  ]);
  await expect(page.getByText(FINAL_NOTE)).toHaveCount(0);

  await expect(ratioField(page)).toHaveValue('1,00');
  await expect(thresholdField(page)).toHaveValue('150,00');
  await expect(
    page.getByText(
      'Il rapporto vale per le spese registrate da ora in poi. La conferma evita errori di battitura, come 1250 al posto di 12,50.',
    ),
  ).toBeVisible();

  await expectTouchTargets([
    page.getByRole('link', { name: 'Indietro' }),
    page.getByRole('button', { name: 'Esci' }),
    ratioField(page),
    thresholdField(page),
    page.getByRole('button', { name: 'Salva' }),
    page.getByRole('link', { name: /Cambia password/ }),
  ]);

  await saveSettings(page, '2,00', '200,00');
  await expect(ratioField(page)).toHaveValue('2,00');
  await expect(thresholdField(page)).toHaveValue('200,00');

  await page.reload();
  await expect(ratioField(page)).toHaveValue('2,00');
  await expect(thresholdField(page)).toHaveValue('200,00');
});

test('an invalid amount shows the Italian message and sends nothing', async ({ page }) => {
  await openSettingsAs(page, seedAccounts.admin.email);
  await expect(ratioField(page)).toHaveValue('2,00');

  const updates: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/rpc/update_settings')) updates.push(request.url());
  });

  await ratioField(page).fill('1,555');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Usa al massimo due decimali, per esempio 1,50.')).toBeVisible();
  await expect(ratioField(page)).toBeFocused();
  await expect(page.getByText('Impostazioni salvate.')).toHaveCount(0);
  expect(updates).toEqual([]);
});

test('an operator sees the ratio in force, read-only, and the final note last', async ({
  page,
}) => {
  await openSettingsAs(page, seedAccounts.operator.email);

  // Wireframe "Impostazioni operatore": account box, PUNTI, ACCOUNT, final note.
  const sections = page.locator('main > section');
  await expect(sections.first()).toHaveAccessibleName('Account');
  await expect(sections.first()).toContainText(seedAccounts.operator.name);
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
    'PUNTI',
    'ACCOUNT',
  ]);

  const points = page.getByRole('region', { name: 'PUNTI', exact: true });
  // formatCents puts a non-breaking space before "€": toHaveText normalizes whitespace.
  await expect(points.getByText(/1 punto ogni/)).toHaveText('1 punto ogni 2,00 € di spesa');
  await expect(points.getByText('Il rapporto lo decide un amministratore.')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Salva' })).toHaveCount(0);
  await expect(page.getByText(/Chiedi conferma/)).toHaveCount(0);

  await expect(page.locator('main > :last-child')).toHaveText(FINAL_NOTE);

  await expectTouchTargets([
    page.getByRole('link', { name: 'Indietro' }),
    page.getByRole('button', { name: 'Esci' }),
    page.getByRole('link', { name: /Cambia password/ }),
  ]);
});
