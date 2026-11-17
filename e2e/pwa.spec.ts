import { expect, test } from './fixtures';

test('the manifest makes the app installable as "Enjoy Card"', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest: unknown = await (await request.get(href ?? '')).json();
  expect(manifest).toMatchObject({
    name: 'Enjoy Card',
    lang: 'it',
    display: 'standalone',
    start_url: '/',
    theme_color: '#00603a',
    background_color: '#faf5f1',
    icons: expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192' }),
      expect.objectContaining({ sizes: '512x512' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]),
  });
});

// Playwright's request interception bypasses service workers, so a runtime probe
// cannot prove anything here. Instead: the generated worker must register no
// route besides the app-shell navigation, and its caches hold only our files.
test('the service worker caches the app shell only, never Supabase', async ({ page, request }) => {
  const sw = await (await request.get('/sw.js')).text();
  const routes = sw.match(/registerRoute\(/g) ?? [];
  expect(routes, 'routes registered by sw.js').toHaveLength(1);
  expect(sw).toContain('registerRoute(new e.NavigationRoute(');
  expect(sw).not.toMatch(/CacheFirst|NetworkFirst|StaleWhileRevalidate|supabase/);

  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const cachedUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    const perCache = await Promise.all(
      names.map(async (name) => (await (await caches.open(name)).keys()).map((entry) => entry.url)),
    );
    return perCache.flat();
  });
  expect(cachedUrls).toContainEqual(expect.stringContaining('/index.html'));
  const origin = new URL(page.url()).origin;
  expect(cachedUrls.filter((url) => !url.startsWith(origin))).toEqual([]);
});

test('security headers are served', async ({ request }) => {
  const response = await request.get('/');
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain('https://*.supabase.co');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
});
