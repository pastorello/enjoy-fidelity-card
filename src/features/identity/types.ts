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

/** Every HTTP answer is 'sent', so no answer reveals whether the account exists. */
export type ResetRequestResult = 'sent' | 'network';
export type VerifyRecoveryResult = 'ok' | 'invalid-link' | 'network' | 'unknown';
export type UpdatePasswordResult = 'ok' | 'same-password' | 'weak' | 'network' | 'unknown';

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
  /**
   * The profile linked to this user, or null when there is none (removed or never linked).
   * Rejects with a `ServerFaultError` when the server is misconfigured or unavailable, with
   * any other error when there is no answer.
   */
  loadOperator(userId: string): Promise<Operator | null>;
  /**
   * Called when the saved session changes outside the app's own calls: with its user id
   * (signed in or refreshed, here or in another tab) or null (expired, revoked, other tab).
   */
  onAuthChange(listener: (userId: string | null) => void): () => void;
  /** The email of the session saved on this device, or null. No network call while it is valid. */
  currentEmail(): Promise<string | null>;
  /** Asks for the recovery email; `redirectTo` is the app's own page, never user input. */
  requestPasswordReset(email: string, redirectTo: string): Promise<ResetRequestResult>;
  /** Consumes the link token and replaces this device's session with the link user's. */
  verifyRecovery(tokenHash: string): Promise<VerifyRecoveryResult>;
  /** Sets the password of the current session's user. */
  updatePassword(password: string): Promise<UpdatePasswordResult>;
  /** Revokes the sessions of the same user on other devices; never fails. */
  signOutOtherDevices(): Promise<void>;
};
