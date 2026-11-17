import { describe, expect, it } from 'vitest';
import { readSupabaseEnv, supabaseClientOptions } from './supabase';

const LOCAL_URL = 'http://127.0.0.1:54321';
const PUBLISHABLE = 'sb_publishable_test_key';

describe('readSupabaseEnv', () => {
  it('returns url and publishable key when both are set', () => {
    expect(
      readSupabaseEnv({ VITE_SUPABASE_URL: LOCAL_URL, VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE }),
    ).toEqual({ url: LOCAL_URL, publishableKey: PUBLISHABLE });
  });

  it('accepts an https project url', () => {
    const env = readSupabaseEnv({
      VITE_SUPABASE_URL: 'https://abcd.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    });
    expect(env.url).toBe('https://abcd.supabase.co');
  });

  it.each([
    [{ VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE }, /VITE_SUPABASE_URL/],
    [{ VITE_SUPABASE_URL: LOCAL_URL }, /VITE_SUPABASE_PUBLISHABLE_KEY/],
    [{ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE }, /VITE_SUPABASE_URL/],
  ])('fails with a clear message when a variable is missing (%o)', (env, message) => {
    expect(() => readSupabaseEnv(env)).toThrow(message);
  });

  it('rejects plain http for a remote host', () => {
    expect(() =>
      readSupabaseEnv({
        VITE_SUPABASE_URL: 'http://abcd.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      }),
    ).toThrow(/https/);
  });

  it('rejects an invalid url', () => {
    expect(() =>
      readSupabaseEnv({
        VITE_SUPABASE_URL: 'not a url',
        VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      }),
    ).toThrow(/VITE_SUPABASE_URL/);
  });

  it('refuses a secret key, which must never reach the browser', () => {
    expect(() =>
      readSupabaseEnv({
        VITE_SUPABASE_URL: LOCAL_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc',
      }),
    ).toThrow(/secret/i);
  });
});

describe('supabaseClientOptions', () => {
  it('never takes a session from a link: no flow of the app signs in from the URL', () => {
    expect(supabaseClientOptions.auth?.detectSessionInUrl).toBe(false);
  });

  it('uses PKCE, so a bare token link cannot set a session', () => {
    expect(supabaseClientOptions.auth?.flowType).toBe('pkce');
  });
});
