import type { Locator, Page } from '@playwright/test';
import { seedAccounts, signIn } from './auth';
import { expect, test } from './fixtures';

/**
 * Rewards catalogue end to end (docs/specs/SPEC-rewards.md, Testing Strategy). Rewards are never
 * deleted, so the reward added here carries a suffix unique to the run: the suite passes again
 * without `db:reset`. The seed rewards are never touched (the ledger E2E relies on them).
 */

/** A suffix unique to this run and this test. */
function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The seed catalogue (supabase/seed.sql) in the order of the wireframe "Catalogo premi". */
const SEED_REWARDS = [
  'Caffè',
  'Cornetto e cappuccino',
  'Colazione per due',
  'Aperitivo',
  'Dolce del giorno',
];

const INACTIVE_NOTE = 'non visibile alla cassa né al cliente';

function catalog(page: Page) {
  return page.getByRole('list', { name: 'Premi del catalogo' });
}

/** The names of the catalogue, top to bottom. */
function rewardNames(page: Page) {
  return catalog(page).locator('[data-reward-name]').allTextContents();
}

function row(page: Page, name: string): Locator {
  return catalog(page)
    .getByRole('listitem')
    .filter({ has: page.locator('[data-reward-name]').getByText(name, { exact: true }) });
}

function activeBox(page: Page, name: string): Locator {
  return page.getByRole('checkbox', { name: `${name} attivo`, exact: true });
}

function newRewardBox(page: Page): Locator {
  return page.getByRole('region', { name: 'Nuovo premio' });
}

async function expectTouchTargets(targets: Locator[]) {
  const boxes = await Promise.all(targets.map((target) => target.boundingBox()));
  boxes.forEach((box, index) => {
    const name = targets[index]?.toString();
    expect(box?.height, `height of ${name}`).toBeGreaterThanOrEqual(48);
    expect(box?.width, `width of ${name}`).toBeGreaterThanOrEqual(48);
  });
}

async function openCatalogFromSettings(page: Page) {
  await page.goto('/impostazioni');
  await page.getByRole('link', { name: /Catalogo premi/ }).click();
  await expect(page).toHaveURL(/\/impostazioni\/premi$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Catalogo premi' })).toBeVisible();
  await expect(catalog(page)).toBeVisible();
}

test.describe('administrator', () => {
  // A name already used is refused by the server (unique index), shown under the name field.
  test.use({ expectedRefusals: [/\/rest\/v1\/rpc\/create_reward$/] });

  test('adds, refuses a duplicate, deactivates, reloads, reactivates and renames a reward', async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `Spremuta E2E ${suffix}`;
    const renamed = `Spremuta grande E2E ${suffix}`;

    await signIn(page, seedAccounts.admin.email);
    await openCatalogFromSettings(page);

    // The seed rewards in the order of the wireframe: active by points, then the inactive one.
    // Rewards left by earlier runs may sit in between: only the seed ones are compared.
    const seedOrder = (await rewardNames(page)).filter((text) => SEED_REWARDS.includes(text));
    expect(seedOrder).toEqual(SEED_REWARDS);
    await expect(row(page, 'Dolce del giorno')).toContainText(`120 punti · ${INACTIVE_NOTE}`);
    await expect(activeBox(page, 'Dolce del giorno')).not.toBeChecked();
    await expect(activeBox(page, 'Caffè')).toBeChecked();

    // Nuovo premio: name, points, Attivo ticked by default.
    const box = newRewardBox(page);
    await expect(box.getByRole('checkbox', { name: 'Attivo' })).toBeChecked();

    // Touch targets: header, every row (button and Attivo box), the Nuovo premio box.
    await expectTouchTargets([
      page.getByRole('link', { name: 'Indietro' }),
      ...SEED_REWARDS.flatMap((seed) => [
        row(page, seed).getByRole('button'),
        // The touch area of the box is its whole label.
        page.locator('label', { has: activeBox(page, seed) }),
      ]),
      box.getByLabel('Nome del premio'),
      box.getByLabel('Punti richiesti'),
      box.locator('label', { has: page.getByRole('checkbox', { name: 'Attivo' }) }),
      box.getByRole('button', { name: 'Aggiungi premio' }),
    ]);

    // Adds "Spremuta E2E …", 80 points: it shows active, between Caffè (50) and Cornetto (100).
    await box.getByLabel('Nome del premio').fill(name);
    await box.getByLabel('Punti richiesti').fill('80');
    await box.getByRole('button', { name: 'Aggiungi premio' }).click();
    await expect(box.getByText('Premio aggiunto')).toBeVisible();
    await expect(box.getByLabel('Nome del premio')).toHaveValue('');
    await expect(row(page, name)).toContainText('80 punti');
    await expect(row(page, name)).not.toContainText(INACTIVE_NOTE);
    await expect(activeBox(page, name)).toBeChecked();
    const names = await rewardNames(page);
    expect(names.indexOf(name)).toBeGreaterThan(names.indexOf('Caffè'));
    expect(names.indexOf(name)).toBeLessThan(names.indexOf('Cornetto e cappuccino'));

    // The same name in capitals is refused by the server, under the name field.
    await box.getByLabel('Nome del premio').fill(name.toUpperCase());
    await box.getByLabel('Punti richiesti').fill('80');
    await box.getByRole('button', { name: 'Aggiungi premio' }).click();
    await expect(box.getByText('Esiste già un premio con questo nome')).toBeVisible();
    await expect(box.getByLabel('Nome del premio')).toBeFocused();
    await expect(row(page, name.toUpperCase())).toHaveCount(0);

    // Deactivated: grey, "non visibile alla cassa", after the active rewards.
    await activeBox(page, name).click();
    await expect(row(page, name)).toContainText(`80 punti · ${INACTIVE_NOTE}`);
    await expect(activeBox(page, name)).not.toBeChecked();
    await expect(activeBox(page, name)).toBeEnabled();
    await expect(activeBox(page, name)).toBeFocused();

    // The state is the server's: it stays after a reload.
    await page.reload();
    await expect(catalog(page)).toBeVisible();
    await expect(row(page, name)).toContainText(`80 punti · ${INACTIVE_NOTE}`);
    await expect(activeBox(page, name)).not.toBeChecked();
    const afterReload = await rewardNames(page);
    expect(afterReload.indexOf(name)).toBeGreaterThan(afterReload.indexOf('Aperitivo'));

    // Reactivated: back among the active rewards.
    await activeBox(page, name).click();
    await expect(activeBox(page, name)).toBeChecked();
    await expect(activeBox(page, name)).toBeEnabled();
    await expect(row(page, name)).not.toContainText(INACTIVE_NOTE);

    // Renamed from the "Modifica premio" box, opened by tapping the row.
    await row(page, name).getByRole('button').click();
    const edit = page.getByRole('region', { name: 'Modifica premio' });
    await expect(edit).toBeVisible();
    await expect(newRewardBox(page)).toBeHidden();
    await expect(edit.getByLabel('Nome del premio')).toHaveValue(name);
    await expect(edit.getByLabel('Nome del premio')).toBeFocused();
    await expect(edit.getByLabel('Punti richiesti')).toHaveValue('80');
    await expectTouchTargets([
      edit.getByLabel('Nome del premio'),
      edit.getByLabel('Punti richiesti'),
      edit.getByRole('button', { name: 'Salva modifiche' }),
      edit.getByRole('button', { name: 'Annulla' }),
    ]);
    await edit.getByLabel('Nome del premio').fill(renamed);
    await edit.getByRole('button', { name: 'Salva modifiche' }).click();
    await expect(edit).toBeHidden();
    await expect(newRewardBox(page)).toBeVisible();
    await expect(row(page, renamed)).toContainText('80 punti');
    await expect(row(page, name)).toHaveCount(0);

    await page.reload();
    await expect(row(page, renamed)).toContainText('80 punti');
    await expect(activeBox(page, renamed)).toBeChecked();
    await expect(row(page, name)).toHaveCount(0);

    // Rewards are never deleted: this run's one is left inactive, out of the till's list.
    await activeBox(page, renamed).click();
    await expect(row(page, renamed)).toContainText(INACTIVE_NOTE);

    // The seed rewards are as the seed made them.
    const seedAfter = (await rewardNames(page)).filter((text) => SEED_REWARDS.includes(text));
    expect(seedAfter).toEqual(SEED_REWARDS);
  });
});

test('an operator has no Catalogo premi row, and the direct URL says it is for administrators', async ({
  page,
}) => {
  const rewardRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/rest/v1/rewards') || /\/rpc\/\w*reward/.test(url)) {
      rewardRequests.push(url);
    }
  });

  await signIn(page, seedAccounts.operator.email);
  await page.goto('/impostazioni');
  await expect(page.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Catalogo premi/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'GESTIONE' })).toHaveCount(0);

  await page.goto('/impostazioni/premi');
  await expect(page.getByRole('heading', { level: 1, name: 'Catalogo premi' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Solo per gli amministratori' })).toBeVisible();
  await expect(catalog(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Nuovo premio' })).toHaveCount(0);

  const back = page.getByRole('link', { name: 'Torna alle impostazioni' });
  await expectTouchTargets([page.getByRole('link', { name: 'Indietro' }), back]);
  await back.click();
  await expect(page).toHaveURL(/\/impostazioni$/);

  // No read and no write of the catalogue was sent for the operator.
  expect(rewardRequests).toEqual([]);
});
