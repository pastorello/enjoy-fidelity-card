// SPEC-operators, criterion 5: the key that lets operator-invites act as Auth admin lives only in the
// environment of the Edge Function. This detector finds anything shaped like a Supabase key that
// bypasses Row Level Security, without holding one itself: a secret API key (`sb_secret_` and its
// random part) or a legacy JWT whose payload names the service_role (or the database owner).

export type PrivilegedKeyKind = 'secret API key' | 'service_role JWT';

/** The random part of a real secret key is about 31 characters; 16 leaves the made-up `sb_secret_abc`. */
const SECRET_API_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/;
/** Header and payload of a JWT are base64url JSON objects, so both start with `eyJ` (`{"`). */
const JWT = /eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;
const PRIVILEGED_ROLES = new Set(['service_role', 'supabase_admin']);

function roleOf(payload: string): unknown {
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims === 'object' && claims !== null && 'role' in claims
      ? claims.role
      : undefined;
  } catch {
    return undefined;
  }
}

/** The kinds of privileged key found in `text`, each once, in a fixed order. */
export function findPrivilegedKeys(text: string): PrivilegedKeyKind[] {
  const found: PrivilegedKeyKind[] = [];
  if (SECRET_API_KEY.test(text)) found.push('secret API key');
  const privilegedJwt = [...text.matchAll(JWT)].some((match) =>
    PRIVILEGED_ROLES.has(String(roleOf(match[1]))),
  );
  if (privilegedJwt) found.push('service_role JWT');
  return found;
}
