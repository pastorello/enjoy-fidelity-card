import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

type RawEnv = Partial<Record<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY', string>>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function required(env: RawEnv, name: keyof RawEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}: copy .env.example to .env and fill it in.`);
  }
  return value;
}

/** Validates the Supabase settings exposed to the browser. Throws on misconfiguration. */
export function readSupabaseEnv(env: RawEnv): SupabaseEnv {
  const url = required(env, 'VITE_SUPABASE_URL');
  const publishableKey = required(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`VITE_SUPABASE_URL is not a valid URL: "${url}"`);
  }
  if (parsed.protocol !== 'https:' && !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error('VITE_SUPABASE_URL must use https outside local development.');
  }

  if (publishableKey.startsWith('sb_secret_')) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key: it must never reach the browser.',
    );
  }
  if (!publishableKey.startsWith('sb_publishable_')) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key (sb_publishable_…).');
  }

  return { url, publishableKey };
}

let client: SupabaseClient | undefined;

/** The single Supabase client of the app, created on first use. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const { url, publishableKey } = readSupabaseEnv(import.meta.env);
    client = createClient(url, publishableKey);
  }
  return client;
}
