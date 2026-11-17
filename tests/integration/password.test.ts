import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkHref, waitForMessageTo } from '../../e2e/mailpit';
import { localSupabase, memoryClient } from './localSupabase';

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
    expect(text).toContain('il link vale un’ora e si usa una volta sola.');
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
