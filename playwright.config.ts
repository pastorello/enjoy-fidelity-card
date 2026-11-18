import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
// Same origin as LOCAL_SUPABASE_URL in vite.config.ts (allowed by the preview CSP).
const LOCAL_SUPABASE_URL = 'http://localhost:54321';
/** Specs that change global state (the settings row): kept out of the parallel `phone` project. */
const SHARED_STATE_SPECS = /settings\.spec\.ts$/;

/**
 * E2E always runs against the local Supabase stack, never against the staging project that `.env`
 * points to: these variables take precedence over `.env` when Vite builds the app.
 */
function localSupabaseEnv(): Record<string, string> {
  let output: string;
  try {
    output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error('Local Supabase is not running: start it with `npm run db:start`.');
  }
  const key = /^PUBLISHABLE_KEY="?([^"\n]+)"?$/m.exec(output)?.[1];
  if (!key) throw new Error('`supabase status` printed no PUBLISHABLE_KEY.');
  return { VITE_SUPABASE_URL: LOCAL_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: key };
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      // Main target: Android phone, 390×844 (CLAUDE.md).
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
      testIgnore: SHARED_STATE_SPECS,
    },
    {
      // Specs that change the one shared configuration row: they run after every `phone` test,
      // serially, and put the initial values back (SPEC-settings, Testing Strategy).
      name: 'phone-settings',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
      testMatch: SHARED_STATE_SPECS,
      dependencies: ['phone'],
    },
  ],
  webServer: {
    // The production build, served with the same security headers as Vercel.
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // VITE_E2E installs the fake card reader (window.__enjoyFakeCard, SPEC-card-input point 7).
    env: { ...localSupabaseEnv(), VITE_E2E: '1' },
    // Never reuse a server: it could have been built against staging.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
