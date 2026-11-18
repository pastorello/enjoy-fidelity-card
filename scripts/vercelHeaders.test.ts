import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SPEC-cards, Security: the public points page /s/:token is never cached and never indexed. Vercel
// applies vercel.json only on its own servers (`vite preview` ignores it), so this test reads the file
// and resolves the headers of a path as Vercel does; `curl -I` on the preview checks it for real
// (RUNBOOK).

type Header = { key: string; value: string };
type Rule = { source: string; headers: Header[] };

function isHeader(value: unknown): value is Header {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof value.key === 'string' &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

function isRule(value: unknown): value is Rule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'source' in value &&
    typeof value.source === 'string' &&
    'headers' in value &&
    Array.isArray(value.headers) &&
    value.headers.every(isHeader)
  );
}

/** The `headers` of vercel.json; fails on a rule of any other shape. */
function readRules(): Rule[] {
  const parsed: unknown = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const rules: unknown =
    typeof parsed === 'object' && parsed !== null && 'headers' in parsed ? parsed.headers : null;
  if (!Array.isArray(rules) || !rules.every(isRule)) throw new Error('vercel.json: bad headers');
  return rules;
}

const config = { headers: readRules() };

/**
 * The sources of this file are plain path segments and `(...)` groups, whose content is a regular
 * expression (path-to-regexp): read whole as one anchored regular expression, as Vercel does.
 */
function matches(source: string, path: string): boolean {
  return new RegExp(`^${source}$`).test(path);
}

/** Every rule whose source matches, in order: a later rule overrides an earlier one's key. */
function headersFor(path: string): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const rule of config.headers) {
    if (!matches(rule.source, path)) continue;
    for (const { key, value } of rule.headers) resolved[key.toLowerCase()] = value;
  }
  return resolved;
}

const TOKEN = 'Zq3_x-9KpL2mN8vR4tY6wA';

// The rules that were there before the cards module, as they were: none of them may change.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";
const EXISTING_RULES: Rule[] = [
  {
    source: '/(.*)',
    headers: [
      { key: 'Content-Security-Policy', value: CSP },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ],
  },
  {
    source: '/assets/(.*)',
    headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
  },
  {
    source: '/(sw.js|registerSW.js|manifest.webmanifest|index.html)',
    headers: [{ key: 'Cache-Control', value: 'no-cache' }],
  },
];

describe('vercel.json headers', () => {
  it('has one rule for /s/(.*) with no-store and noindex, nofollow', () => {
    const rules = config.headers.filter((rule) => rule.source === '/s/(.*)');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.headers).toEqual([
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ]);
  });

  it('serves the public points page uncached and unindexed, with the security headers', () => {
    const headers = headersFor(`/s/${TOKEN}`);
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(headers['content-security-policy']).toBe(CSP);
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps every other page as it was: no noindex, no no-store', () => {
    for (const path of ['/', '/clienti/123', '/sicurezza', '/index.html', '/s']) {
      const headers = headersFor(path);
      expect({ path, robots: headers['x-robots-tag'] }).toEqual({ path, robots: undefined });
      expect({ path, cache: headers['cache-control'] }).not.toEqual({ path, cache: 'no-store' });
    }
    expect(headersFor('/assets/index-abc123.js')['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(headersFor('/sw.js')['cache-control']).toBe('no-cache');
  });

  it('leaves the existing rules and the CSP unchanged', () => {
    expect(config.headers.filter((rule) => rule.source !== '/s/(.*)')).toEqual(EXISTING_RULES);
  });
});
