import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { AuthError } from '@supabase/supabase-js';
import { ServerFaultError, serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import type {
  AuthService,
  Operator,
  ResetRequestResult,
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

  async loadOperator(userId) {
    const { data, error, status } = await getSupabase()
      .schema('app')
      .from('operators')
      .select('id, name, role')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      // Status 0: no answer arrived (network). Any answer with an error means the server
      // could not serve a plain read of the own profile: a fault, not a missing connection.
      if (status === 0) throw new Error(`Cannot load the operator profile: ${error.message}`);
      throw new ServerFaultError(serverFaultFor(error, status) ?? 'misconfigured');
    }
    if (!data) return null;
    const row: { id: unknown; name: unknown; role: unknown } = data;
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || !isRole(row.role)) {
      throw new Error('Unexpected operator profile shape');
    }
    return { id: row.id, name: row.name, role: row.role };
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

  async verifyRecovery(tokenHash) {
    try {
      const { error } = await getSupabase().auth.verifyOtp({
        type: 'recovery',
        token_hash: tokenHash,
      });
      return verifyRecoveryResultFor(error);
    } catch {
      return 'network';
    }
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
