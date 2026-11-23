import type { Page } from '@playwright/test';
import { signIn } from './auth';
import { createCustomers } from './db';
import { expect, homeCustomers, homeSearch, test } from './fixtures';
import { uniqueName } from './nfc';

/**
 * The CLIENTI list of the home end to end (SPEC-customers-v2 point 6, criterion 5), against the
 * local stack. The list without a filter changes under the other tests running in parallel on the
 * same database, so this test lists only its own customers: 45 names that share a prefix unique
 * to the run, typed in the search field. The full list is proved by the component tests with the
 * fake service.
 */

const CUSTOMERS = 45;
const PAGE_SIZE = 20;

/** The names of this test's customers in the rows of CLIENTI, top to bottom. */
async function listedNames(page: Page, prefix: string): Promise<string[]> {
  const texts = await homeCustomers(page).getByRole('link').allInnerTexts();
  return texts.map((text) =>
    text.slice(text.indexOf(prefix), text.indexOf(prefix) + prefix.length + 3),
  );
}

/** Brings «Mostra altri clienti» into view without pressing it: the sentinel above it asks the next page. */
async function scrollToEnd(page: Page) {
  await homeCustomers(page)
    .getByRole('button', { name: 'Mostra altri clienti' })
    .scrollIntoViewIfNeeded();
}

test('CLIENTI: 20 rows, the others by scrolling, no duplicates, the end at the 45th; the customer just served goes on top (criterion 5)', async ({
  page,
}) => {
  const prefix = uniqueName('Scorrimento E2E');
  // 01 is the oldest: newest first, the home lists them from 45 down to 01.
  const names = Array.from(
    { length: CUSTOMERS },
    (_, index) => `${prefix} ${String(index + 1).padStart(2, '0')}`,
  );
  const ids = createCustomers(names);
  const newestFirst = names.toReversed();

  await signIn(page);
  await page.goto('/');
  await homeSearch(page).fill(prefix);

  const rows = homeCustomers(page).getByRole('link');
  // Polled: until the search answers, the field shows the list without a filter.
  await expect.poll(() => listedNames(page, prefix)).toEqual(newestFirst.slice(0, PAGE_SIZE));
  await expect(rows).toHaveCount(PAGE_SIZE);
  await expect(rows.first()).toContainText('Nessun movimento');

  // Scrolling, not pressing: the next pages come from the sentinel.
  await scrollToEnd(page);
  await expect(rows).toHaveCount(2 * PAGE_SIZE);
  await scrollToEnd(page);
  await expect(rows).toHaveCount(CUSTOMERS);

  // The end of the list: nothing more to ask, and nothing more arrives.
  const more = homeCustomers(page).getByRole('button', { name: 'Mostra altri clienti' });
  await expect(more).toHaveCount(0);
  await expect(homeCustomers(page).getByText('Carico altri clienti…')).toHaveCount(0);
  const listed = await listedNames(page, prefix);
  expect(new Set(listed).size, 'no duplicates').toBe(CUSTOMERS);
  expect(listed, 'no gaps, newest first').toEqual(newestFirst);

  // The oldest one, last in the list, is served: back on the home it is first.
  const oldest = ids[0];
  if (oldest === undefined) throw new Error('No customer created');
  await page.goto(`/clienti/${oldest}/spesa`);
  await expect(page.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeVisible();
  const keypad = page.getByRole('group', { name: 'Tastierino numerico' });
  await keypad.getByRole('button', { name: '5', exact: true }).click();
  await keypad.getByRole('button', { name: '0', exact: true }).click();
  await keypad.getByRole('button', { name: '0', exact: true }).click();
  await page.getByRole('button', { name: 'Conferma +5' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeVisible();

  await page.goto('/');
  await homeSearch(page).fill(prefix);
  await expect
    .poll(() => listedNames(page, prefix))
    .toEqual([names[0], ...newestFirst.slice(0, PAGE_SIZE - 1)]);
  await expect(rows).toHaveCount(PAGE_SIZE);
  await expect(rows.first()).toContainText(/Oggi, \d{2}:\d{2}/);
  await expect(rows.first()).toContainText('5 punti');
});
