import { readFileSync } from 'node:fs';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

function isHeaderRule(value: unknown): value is HeaderRule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'source' in value &&
    typeof value.source === 'string' &&
    'headers' in value &&
    Array.isArray(value.headers)
  );
}

/** Security headers from vercel.json, so `vite preview` (and E2E) behaves like production. */
function productionHeaders(): Record<string, string> {
  const config: unknown = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const rules: unknown[] =
    typeof config === 'object' &&
    config !== null &&
    'headers' in config &&
    Array.isArray(config.headers)
      ? config.headers
      : [];
  const global = rules.filter(isHeaderRule).find((rule) => rule.source === '/(.*)');
  if (!global) throw new Error('vercel.json: missing the "/(.*)" security headers');
  return Object.fromEntries(global.headers.map(({ key, value }) => [key, value]));
}

/** Local Supabase API used by E2E (see playwright.config.ts). Preview CSP only, never vercel.json. */
const LOCAL_SUPABASE_URL = 'http://localhost:54321';

function previewHeaders(): Record<string, string> {
  const headers = productionHeaders();
  const csp = headers['Content-Security-Policy'];
  if (csp) {
    headers['Content-Security-Policy'] = csp.replace(
      'connect-src ',
      `connect-src ${LOCAL_SUPABASE_URL} `,
    );
  }
  return headers;
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // `npm run dev:https`: self-signed HTTPS on the local network, to try the app on a phone.
    mode === 'https' && basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script', // a file, not inline: the CSP forbids inline scripts
      includeAssets: ['icons/apple-touch-icon-180.png', 'icons/favicon-48.png'],
      manifest: {
        id: '/',
        name: 'Enjoy Card',
        short_name: 'Enjoy Card',
        description: 'Fidelity card a punti dell’Enjoy Bar',
        lang: 'it',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#00603a',
        background_color: '#faf5f1',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell only. No runtime caching: Supabase data is never cached (no offline mode).
        globPatterns: ['**/*.{js,css,html,woff2,webp,png}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  server: mode === 'https' ? { host: true } : {},
  preview: { headers: previewHeaders() },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
}));
