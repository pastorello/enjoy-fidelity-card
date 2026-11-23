import { randomBytes, randomUUID } from 'node:crypto';
import { isAuthApiError } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkHref, waitForMessageTo } from '../../e2e/mailpit';
import { localSupabase, memoryClient, runSql } from './localSupabase';

const local = localSupabase();
const admin = memoryClient(local.url, local.secretKey);

/** A throwaway Auth user, so the seed accounts used by E2E are never touched. */
const email = `recupero-${randomUUID()}@example.com`;
const REDIRECT_TO = 'http://localhost:4173/imposta-password';
let userId: string | undefined;

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: randomBytes(18).toString('base64url'),
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
});

/** A random password of exactly `length` characters (the server minimum is 8). */
const randomPassword = (length: number) =>
  randomBytes(length).toString('base64url').slice(0, length);

describe('password recovery email (local stack + Mailpit)', () => {
  let link: URL;

  it('sends the Italian template with a token_hash link to the requested page', async () => {
    const client = memoryClient(local.url, local.publishableKey);
    const since = new Date();
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_TO });
    expect(error).toBeNull();

    const message = await waitForMessageTo(email, since);
    expect(message.subject).toBe('Enjoy Card: scegli una nuova password');
    const text = message.html.replace(/\s+/g, ' ');
    expect(text).toContain('Hai chiesto di scegliere una nuova password per l’Enjoy Card.');
    expect(text).toContain('il link vale 24 ore e si usa una volta sola.');
    expect(text).toContain('Se non l’hai chiesto tu, ignora questa email');
    expect(message.html).not.toMatch(/<img\b/i);

    const href = linkHref(message.html, 'Scegli la password');
    expect(href.startsWith(`${REDIRECT_TO}?token_hash=`)).toBe(true);
    link = new URL(href);
    expect(link.searchParams.get('type')).toBe('recovery');
    expect(link.searchParams.get('token_hash')).toBeTruthy();
  });

  it('opens a session with the link, enforces 8 characters, and burns the token', async () => {
    const tokenHash = link.searchParams.get('token_hash') ?? '';
    const client = memoryClient(local.url, local.publishableKey);

    const verified = await client.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    expect(verified.error).toBeNull();
    expect(verified.data.session?.user.email).toBe(email);

    const tooShort = await client.auth.updateUser({ password: randomPassword(7) });
    expect(tooShort.error?.code).toBe('weak_password');

    const newPassword = randomPassword(8);
    const updated = await client.auth.updateUser({ password: newPassword });
    expect(updated.error).toBeNull();

    const fresh = memoryClient(local.url, local.publishableKey);
    const signIn = await fresh.auth.signInWithPassword({ email, password: newPassword });
    expect(signIn.error).toBeNull();

    const again = memoryClient(local.url, local.publishableKey);
    const reused = await again.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    expect(reused.error).not.toBeNull();
    expect(reused.data.session).toBeNull();
  });
});

describe('saving a recovered password (local stack)', () => {
  /** Another throwaway user, so this block never waits on the email rate limit of the first. */
  const otherEmail = `recupero-${randomUUID()}@example.com`;
  const oldPassword = randomPassword(16);
  let otherId: string | undefined;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: otherEmail,
      password: oldPassword,
      email_confirm: true,
    });
    if (error) throw error;
    otherId = data.user.id;
  });

  afterAll(async () => {
    if (otherId) await admin.auth.admin.deleteUser(otherId).catch(() => undefined);
  });

  it('answers same_password to a repeated save and signs the other devices out', async () => {
    // Device B: signed in with the old password before the recovery.
    const deviceB = memoryClient(local.url, local.publishableKey);
    const signedIn = await deviceB.auth.signInWithPassword({
      email: otherEmail,
      password: oldPassword,
    });
    expect(signedIn.error).toBeNull();

    // The emailed link carries this hashed token (sent without email, as Mailpit is tested above).
    const link = await admin.auth.admin.generateLink({ type: 'recovery', email: otherEmail });
    expect(link.error).toBeNull();
    const tokenHash = link.data.properties?.hashed_token ?? '';

    // Device A: the recovery page, as AuthProvider drives it.
    const deviceA = memoryClient(local.url, local.publishableKey);
    const verified = await deviceA.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    expect(verified.error).toBeNull();

    const newPassword = randomPassword(12);
    const saved = await deviceA.auth.updateUser({ password: newPassword });
    expect(saved.error).toBeNull();

    // A retry after a lost answer sends the same password again: the idempotent case. This is
    // the very error supabaseAuthService.test.ts maps to 'same-password' (AuthProvider then
    // counts it as saved); the mapper lives next to the browser client, so it is not imported.
    const repeated = await deviceA.auth.updateUser({ password: newPassword });
    expect(isAuthApiError(repeated.error)).toBe(true);
    expect(repeated.error?.status).toBe(422);
    expect(repeated.error?.code).toBe('same_password');

    // GoTrue already drops the other sessions when the password changes; the app's own
    // signOut({ scope: 'others' }) must also work in a recovery session. Device C signs in
    // after the save, so only that call can sign it out.
    const deviceC = memoryClient(local.url, local.publishableKey);
    const signedInC = await deviceC.auth.signInWithPassword({
      email: otherEmail,
      password: newPassword,
    });
    expect(signedInC.error).toBeNull();

    const others = await deviceA.auth.signOut({ scope: 'others' });
    expect(others.error).toBeNull();

    // B (old password) and C have their refresh tokens revoked; A keeps its session.
    const refreshedB = await deviceB.auth.refreshSession();
    expect(refreshedB.error).not.toBeNull();
    expect(refreshedB.data.session).toBeNull();
    const refreshedC = await deviceC.auth.refreshSession();
    expect(refreshedC.error).not.toBeNull();
    expect(refreshedC.data.session).toBeNull();
    const refreshedA = await deviceA.auth.refreshSession();
    expect(refreshedA.error).toBeNull();
    const userA = await deviceA.auth.getUser();
    expect(userA.error).toBeNull();
    expect(userA.data.user?.email).toBe(otherEmail);
  });
});

// SPEC-operators Open Questions 7 (decided 2026-11-23): otp_expiry is 86400 s, so a recovery link
// works for 24 hours (the invite link shares it). Auth measures the age from recovery_sent_at.
describe('the recovery link lasts 24 hours (local stack)', () => {
  const agedEmail = `recupero-${randomUUID()}@example.com`;
  let agedId: string | undefined;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: agedEmail,
      password: randomPassword(16),
      email_confirm: true,
    });
    if (error) throw error;
    agedId = data.user.id;
  });

  afterAll(async () => {
    if (agedId) await admin.auth.admin.deleteUser(agedId).catch(() => undefined);
  });

  /** A new recovery token, sent `hours` ago as Auth sees it. */
  async function linkSentHoursAgo(hours: number): Promise<string> {
    const link = await admin.auth.admin.generateLink({ type: 'recovery', email: agedEmail });
    if (link.error) throw link.error;
    runSql(
      `update auth.users set recovery_sent_at = now() - make_interval(hours => :'hours'::int)
       where id = :'id'::uuid;`,
      { hours: String(hours), id: agedId ?? '' },
    );
    return link.data.properties.hashed_token;
  }

  it('a link sent 23 hours ago still opens a session', async () => {
    const tokenHash = await linkSentHoursAgo(23);
    const client = memoryClient(local.url, local.publishableKey);
    const verified = await client.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    expect(verified.error).toBeNull();
    expect(verified.data.session?.user.email).toBe(agedEmail);
  });

  it('a link sent 25 hours ago answers otp_expired', async () => {
    const tokenHash = await linkSentHoursAgo(25);
    const client = memoryClient(local.url, local.publishableKey);
    const verified = await client.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    expect(verified.error?.code).toBe('otp_expired');
    expect(verified.data.session).toBeNull();
  });
});
