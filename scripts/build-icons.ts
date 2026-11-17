// Usage: npm run icons
// Renders the PWA icons from the official badge (design system "Enjoy Bar"):
// white ENJOY ring on an enjoy-green square. Needs Playwright's Chromium.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const GREEN = '#00603a'; // enjoy-green
const badge = readFileSync('design/enjoy-badge-solo-negative.png').toString('base64');

// [file, size, share of the side taken by the badge]
const icons: [string, number, number][] = [
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  // Maskable: keep the badge inside the 80% safe zone of any mask shape.
  ['icon-maskable-512.png', 512, 0.6],
  ['apple-touch-icon-180.png', 180, 0.75],
  ['favicon-48.png', 48, 0.9],
];

const browser = await chromium.launch();
await Promise.all(
  icons.map(async ([file, size, share]) => {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${GREEN}">
         <img src="data:image/png;base64,${badge}" style="width:${Math.round(size * share)}px;height:auto">
       </body>`,
    );
    await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    await page.screenshot({ path: `public/icons/${file}` });
    await page.close();
    console.log(`Wrote public/icons/${file}`);
  }),
);
await browser.close();
