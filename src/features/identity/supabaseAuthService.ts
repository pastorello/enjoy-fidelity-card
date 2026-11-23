import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { AuthError } from '@supabase/supabase-js';
import { ServerFaultError, serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import type {
  AuthService,
  Operator,
  ResetRequestResult,
  SessionIdentity,
  SignInResult,
  UpdatePasswordResult,
  VerifyRecoveryResult,
} from './types';

/** Maps a Supabase sign-in error to what the sign-in page needs to say. */
export function signInResultFor(error: AuthError | null): SignInResult {
  if (!error) return 'ok';
  if (isAuthRetryableFetchError(error)) return 'network';
  if (isAuthApiError(error)) {
    if (error.status === 429) return 'rate-limited';
    if (error.code === 'invalid_credentials' || error.status === 400) return 'invalid';
  }
  return 'unknown';
}

/**
 * True only when no HTTP answer arrived (failed fetch: status 0). Not the same as
 * `isAuthRetryableFetchError`, which is also true for 5xx answers.
 */
function isNoResponse(error: AuthError): boolean {
  return isAuthRetryableFetchError(error) && error.status === 0;
}

/**
 * Any HTTP answer, 429 and 5xx included, is 'sent': a 504 from a slow email send happens only
 * for real accounts, so telling it apart would reveal which emails have an account.
 */
export function resetRequestResultFor(error: AuthError | null): ResetRequestResult {
  return error && isNoResponse(error) ? 'network' : 'sent';
}

export function verifyRecoveryResultFor(error: AuthError | null): VerifyRecoveryResult {
  if (!error) return 'ok';
  if (isNoResponse(error)) return 'network';
  if (error.code === 'otp_expired' || error.status === 403) return 'invalid-link';
  return 'unknown';
}

export function updatePasswordResultFor(error: AuthError | null): UpdatePasswordResult {
  if (!error) return 'ok';
  if (isNoResponse(error)) return 'network';
  if (error.code === 'same_password') return 'same-password';
  if (error.code === 'weak_password') return 'weak';
  return 'unknown';
}

// No method below logs: email, password and link token must never reach a log.

function isRole(value: unknown): value is Operator['role'] {
  return value === 'admin' || value === 'operator';
}

function record(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  return { ...data };
}

const isString = (value: unknown): value is string => typeof value === 'string';

/** A timestamptz as PostgREST writes it, microseconds included. */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/;

/** The instant of a timestamptz, or null when it is not one. Microseconds are dropped. */
function toDate(value: unknown): Date | null {
  if (!isString(value)) return null;
  const parts = TIMESTAMP.exec(value);
  if (!parts) return null;
  const [, seconds = '', fraction = '', zone = ''] = parts;
  const date = new Date(`${seconds}${fraction.slice(0, 4)}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toOperator(data: unknown): Operator | null {
  const row = record(data);
  if (!row) return null;
  const { id, name, role } = row;
  if (!isString(id) || !isString(name) || !isRole(role)) return null;
  return { id, name, role };
}

/**
 * Maps the jsonb answer of `app.get_session_identity()`. `undefined` when its shape is unexpected:
 * nothing is guessed (a cashier without the end of the turn is not a cashier).
 */
function toIdentity(data: unknown): SessionIdentity | null | undefined {
  if (data === null) return null;
  const identity = record(data);
  if (!identity) return undefined;
  if (identity.kind === 'operator') {
    const operator = toOperator(identity.operator);
    const hasPin = record(identity.operator)?.has_pin;
    if (!operator || typeof hasPin !== 'boolean') return undefined;
    return { kind: 'operator', operator, hasPin };
  }
  if (identity.kind !== 'device') return undefined;
  const device = record(identity.device);
  const { lock_seconds_left: lockSecondsLeft } = identity;
  if (!device || !isString(device.id) || !isString(device.name)) return undefined;
  if (typeof lockSecondsLeft !== 'number' || !Number.isInteger(lockSecondsLeft)) return undefined;
  if (lockSecondsLeft < 0) return undefined;
  let cashier: Operator | null = null;
  let turnExpiresAt: Date | null = null;
  if (identity.cashier !== null) {
    cashier = toOperator(identity.cashier);
    turnExpiresAt = toDate(identity.turn_expires_at);
    if (!cashier || !turnExpiresAt) return undefined;
  } else if (identity.turn_expires_at !== null) {
    return undefined;
  }
  return {
    kind: 'device',
    device: { id: device.id, name: device.name },
    cashier,
    turnExpiresAt,
    lockSecondsLeft,
  };
}

/** Consumes the token of an email link; the session becomes the link user's. */
async function verifyLink(
  type: 'recovery' | 'invite',
  tokenHash: string,
): Promise<VerifyRecoveryResult> {
  try {
    const { error } = await getSupabase().auth.verifyOtp({ type, token_hash: tokenHash });
    return verifyRecoveryResultFor(error);
  } catch {
    return 'network';
  }
}

export const supabaseAuthService: AuthService = {
  async currentUserId() {
    const { data, error } = await getSupabase().auth.getSession();
    // Offline (or 5xx) while refreshing an expired token: the session is still saved and
    // will work again, so this is a network error ("Riprova"), not a sign-out.
    if (isAuthRetryableFetchError(error)) {
      throw new Error(`Cannot refresh the saved session: ${error.message}`);
    }
    return data.session?.user.id ?? null;
  },

  async signIn(email, password) {
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      return signInResultFor(error);
    } catch {
      return 'network';
    }
  },

  async signOut() {
    // This device only: other phones of the same operator stay signed in.
    await getSupabase().auth.signOut({ scope: 'local' });
  },

  async loadIdentity() {
    const { data, error, status } = await getSupabase().schema('app').rpc('get_session_identity');
    if (error) {
      // Status 0: no answer arrived (network). Any answer with an error means the server could
      // not tell who is signed in: a fault, not a missing connection.
      if (status === 0) throw new Error(`Cannot load the session identity: ${error.message}`);
      throw new ServerFaultError(serverFaultFor(error, status) ?? 'misconfigured');
    }
    const identity = toIdentity(data);
    if (identity === undefined) throw new Error('Unexpected session identity shape');
    return identity;
  },

  onAuthChange(listener) {
    const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
      // Never await Supabase calls inside this callback (it holds the auth lock).
      // Only SIGNED_OUT means "no session": other events without one say nothing new.
      const userId = event === 'SIGNED_OUT' ? null : session?.user.id;
      if (userId !== undefined) setTimeout(() => listener(userId), 0);
    });
    return () => data.subscription.unsubscribe();
  },

  async currentEmail() {
    // Only prefills a form: a session that cannot be refreshed means "no email", not an error.
    const { data, error } = await getSupabase().auth.getSession();
    if (error) return null;
    return data.session?.user.email ?? null;
  },

  async requestPasswordReset(email, redirectTo) {
    try {
      const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo });
      return resetRequestResultFor(error);
    } catch {
      return 'network';
    }
  },

  verifyRecovery(tokenHash) {
    return verifyLink('recovery', tokenHash);
  },

  verifyInvite(tokenHash) {
    return verifyLink('invite', tokenHash);
  },

  async updatePassword(password) {
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      return updatePasswordResultFor(error);
    } catch {
      return 'network';
    }
  },

  async signOutOtherDevices() {
    // Other devices leave at their next token refresh; failing here must not block the user,
    // whose new password is already saved.
    try {
      await getSupabase().auth.signOut({ scope: 'others' });
    } catch {
      // Ignored on purpose (see above).
    }
  },
};
