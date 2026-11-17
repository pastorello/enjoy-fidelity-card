export type Role = 'admin' | 'operator';

/** The profile of the person using the app (`app.operators`). */
export type Operator = {
  id: string;
  name: string;
  role: Role;
};

export function roleLabel(role: Role): string {
  return role === 'admin' ? 'Amministratore' : 'Operatore';
}

export type SignInResult = 'ok' | 'invalid' | 'network' | 'rate-limited' | 'unknown';

/** Why the app is signed out, shown on the sign-in page. */
export type SignedOutReason = 'expired' | 'not-enabled';

/**
 * Everything the identity feature needs from Supabase Auth. The app uses the Supabase
 * implementation; tests pass a fake.
 */
export type AuthService = {
  /** The user id of the session saved on this device, if any. Throws on network errors. */
  currentUserId(): Promise<string | null>;
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Ends the session on this device only. */
  signOut(): Promise<void>;
  /** The profile linked to this user, or null when there is none (removed or never linked). */
  loadOperator(userId: string): Promise<Operator | null>;
  /** Called when the session ends without the user asking (expired, revoked, other tab). */
  onSignedOut(listener: () => void): () => void;
};
