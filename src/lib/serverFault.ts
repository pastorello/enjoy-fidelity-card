/**
 * A Data API answer that says the server, not the network or the user, is at fault:
 * 'misconfigured' when schema `app` is not exposed (PGRST106), a table or function is missing
 * from the schema cache (PGRST205, PGRST202: a migration not pushed) or a grant is missing
 * (42501 "permission denied for schema/table/function"), which only an administrator can fix;
 * 'unavailable'
 * while the API is (re)loading (503, PGRST002), which passes on its own.
 */
export type ServerFault = 'misconfigured' | 'unavailable';

/** The parts of a supabase-js error this module looks at. */
type AnswerError = { code?: string; message?: string } | null;

/** Schema not exposed, table or function not in the schema cache. */
const MISSING_FROM_API = new Set(['PGRST106', 'PGRST202', 'PGRST205']);

/** Postgres's own wording for a missing grant, unlike the app's refusals. */
const MISSING_GRANT = /permission denied for (schema|table|view|sequence|function)/i;

export function serverFaultFor(error: AnswerError, status: number): ServerFault | null {
  if (!error) return null;
  if (MISSING_FROM_API.has(error.code ?? '')) return 'misconfigured';
  // A 42501 raised by the app's own functions ("Only an admin…") is a refusal, not a fault.
  if (error.code === '42501' && MISSING_GRANT.test(error.message ?? '')) {
    return 'misconfigured';
  }
  if (error.code === 'PGRST002' || status === 503) return 'unavailable';
  return null;
}

/** Thrown by service methods that reject, so callers can word a server fault apart. */
export class ServerFaultError extends Error {
  readonly kind: ServerFault;

  constructor(kind: ServerFault) {
    super(`The server answered with a fault (${kind})`);
    this.name = 'ServerFaultError';
    this.kind = kind;
  }
}
