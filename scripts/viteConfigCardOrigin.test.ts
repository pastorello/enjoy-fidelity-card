// @vitest-environment node
import type { ConfigEnv } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

// SPEC-cards 8.6: the production build fails when VITE_CARD_LINK_ORIGIN is missing or not https.
// cardLinkUrl.test.ts checks the helper; this test runs the real config factory, so dropping its call,
// gating it on the wrong command, or reading the variable in a way that loses it turns it red.

const VARIABLES = ['VERCEL_ENV', 'VITE_CARD_LINK_ORIGIN'] as const;
type Variables = Partial<Record<(typeof VARIABLES)[number], string>>;

let saved: Variables = {};

beforeEach(() => {
  saved = Object.fromEntries(VARIABLES.map((name) => [name, process.env[name]]));
  for (const name of VARIABLES) delete process.env[name];
});

afterEach(() => {
  for (const name of VARIABLES) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** Runs the config factory as Vite does, for `command`, with only `env` set of the two variables. */
function runConfig(command: ConfigEnv['command'], env: Variables): void {
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  if (typeof viteConfig !== 'function') throw new Error('vite.config.ts must export a factory');
  const config = viteConfig({
    command,
    mode: 'production',
    isSsrBuild: false,
    isPreview: false,
  });
  // A promise would hide a throw from the assertions: the factory must stay synchronous.
  expect(config).not.toBeInstanceOf(Promise);
}

describe('vite.config.ts: the card link origin in the production build (SPEC-cards 8.6)', () => {
  it('fails a production build without VITE_CARD_LINK_ORIGIN', () => {
    expect(() => runConfig('build', { VERCEL_ENV: 'production' })).toThrow(/VITE_CARD_LINK_ORIGIN/);
  });

  it('fails a production build with an http origin', () => {
    expect(() =>
      runConfig('build', {
        VERCEL_ENV: 'production',
        VITE_CARD_LINK_ORIGIN: 'http://card.example.test',
      }),
    ).toThrow(/https/);
  });

  it('builds production with an https origin', () => {
    expect(() =>
      runConfig('build', {
        VERCEL_ENV: 'production',
        VITE_CARD_LINK_ORIGIN: 'https://card.example.test',
      }),
    ).not.toThrow();
  });

  it('builds a preview without the variable (the app uses location.origin)', () => {
    expect(() => runConfig('build', { VERCEL_ENV: 'preview' })).not.toThrow();
  });

  it('serves in development without the variable, even with VERCEL_ENV=production', () => {
    expect(() => runConfig('serve', { VERCEL_ENV: 'production' })).not.toThrow();
  });
});
