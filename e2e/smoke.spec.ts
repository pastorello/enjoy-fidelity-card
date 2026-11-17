import { expect, test } from './fixtures';

test('home loads with the green header and the brand fonts', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Enjoy Card');
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('heading', { level: 1, name: 'Enjoy Card' })).toBeVisible();
  await expect(banner).toHaveCSS('background-color', 'rgb(0, 96, 58)');
  await expect(banner).toHaveCSS('height', '64px');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px Texturina'))).toBe(true);
});

test('unknown paths show the Italian not-found page', async ({ page }) => {
  await page.goto('/non-esiste');
  await expect(page.getByRole('heading', { level: 1, name: 'Pagina non trovata' })).toBeVisible();
  await page.getByRole('link', { name: 'Torna all’inizio' }).click();
  await expect(page).toHaveURL('/');
});

test('the component gallery is not part of the production build', async ({ page }) => {
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { level: 1, name: 'Pagina non trovata' })).toBeVisible();
});

test('no request leaves for third-party font or analytics hosts', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost') external.push(url.href);
  });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  expect(external).toEqual([]);
});

test('search engines are told not to index the internal app', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.headers()['content-type']).toContain('text/plain');
  expect(await response.text()).toContain('Disallow: /');
});
