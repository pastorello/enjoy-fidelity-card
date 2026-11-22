// Edge Function `operator-invites` (SPEC-operators point 5): the only file with Deno globals. It
// reads the environment of the Edge runtime, makes the two clients and hands every request to
// handler.ts. Keys never come from the repo: the runtime provides SUPABASE_*, the project only
// APP_ORIGINS (and APP_PREVIEW_ORIGIN on staging). Outside tsc and oxlint; `deno check index.ts`.
import { createClient } from '@supabase/supabase-js';
import { handle, type LogEntry } from './handler.ts';

/** `default` of a JSON dictionary of keys (SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS), else the legacy key. */
function key(dictionary: string, legacy: string): string {
  const raw = Deno.env.get(dictionary);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && 'default' in parsed) {
        const value = parsed.default;
        if (typeof value === 'string' && value !== '') return value;
      }
    } catch {
      // Not JSON: fall back to the legacy variable below.
    }
  }
  return required(legacy);
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`operator-invites: ${name} is not set`);
  return value;
}

// Fail closed at boot: without every variable the function never answers a request.
const url = required('SUPABASE_URL');
const publishableKey = key('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const secretKey = key('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
const appOrigins = required('APP_ORIGINS');
const previewOrigin = Deno.env.get('APP_PREVIEW_ORIGIN');

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** Secret key: only the service_role steps, never the caller's checks. */
const adminClient = createClient(url, secretKey, { auth: noSession });

/** Publishable key plus the caller's Authorization: PostgREST checks the token, the RPC the role. */
function callerClient(authorization: string) {
  return createClient(url, publishableKey, {
    auth: noSession,
    global: { headers: { Authorization: authorization } },
  });
}

/** Only operation_id, action and outcome: never emails, tokens or Auth messages. */
function log({ operation_id, action, outcome }: LogEntry): void {
  console.log(JSON.stringify({ fn: 'operator-invites', operation_id, action, outcome }));
}

Deno.serve((request) =>
  handle(request, {
    env: { APP_ORIGINS: appOrigins, APP_PREVIEW_ORIGIN: previewOrigin },
    callerClient,
    adminClient,
    log,
  }),
);
