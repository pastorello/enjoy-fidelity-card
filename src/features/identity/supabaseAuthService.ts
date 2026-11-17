import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { AuthError } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase';
import type { AuthService, Operator, SignInResult } from './types';

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

function isRole(value: unknown): value is Operator['role'] {
  return value === 'admin' || value === 'operator';
}

export const supabaseAuthService: AuthService = {
  async currentUserId() {
    const { data } = await getSupabase().auth.getSession();
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
    const { data, error } = await getSupabase()
      .schema('app')
      .from('operators')
      .select('id, name, role')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`Cannot load the operator profile: ${error.message}`);
    if (!data) return null;
    const row: { id: unknown; name: unknown; role: unknown } = data;
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || !isRole(row.role)) {
      throw new Error('Unexpected operator profile shape');
    }
    return { id: row.id, name: row.name, role: row.role };
  },

  onSignedOut(listener) {
    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      // Never await Supabase calls inside this callback (it holds the auth lock).
      if (event === 'SIGNED_OUT') setTimeout(listener, 0);
    });
    return () => data.subscription.unsubscribe();
  },
};
