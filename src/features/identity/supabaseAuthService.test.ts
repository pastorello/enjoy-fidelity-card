import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  AuthWeakPasswordError,
} from '@supabase/supabase-js';
import type { AuthError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { signInResultFor, supabaseAuthService } from './supabaseAuthService';

const auth = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<unknown>>(),
  resetPasswordForEmail: vi.fn<(email: string, options: unknown) => Promise<unknown>>(),
  verifyOtp: vi.fn<(params: unknown) => Promise<unknown>>(),
  updateUser: vi.fn<(attributes: unknown) => Promise<unknown>>(),
  signOut: vi.fn<(options: unknown) => Promise<unknown>>(),
}));
const db = vi.hoisted(() => ({
  schema: vi.fn<(name: string) => void>(),
  rpc: vi.fn<(fn: string) => Promise<unknown>>(),
}));
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({
    auth,
    schema: (name: string) => {
      db.schema(name);
      return { rpc: db.rpc };
    },
  }),
}));

describe('signInResultFor', () => {
  it('no error means signed in', () => {
    expect(signInResultFor(null)).toBe('ok');
  });

  it('wrong email or password, without saying which', () => {
    expect(
      signInResultFor(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')),
    ).toBe('invalid');
  });

  it('too many attempts', () => {
    expect(
      signInResultFor(new AuthApiError('Too many requests', 429, 'over_request_rate_limit')),
    ).toBe('rate-limited');
  });

  it('no connection', () => {
    expect(signInResultFor(new AuthRetryableFetchError('Failed to fetch', 0))).toBe('network');
  });

  it('anything else', () => {
    expect(signInResultFor(new AuthApiError('Database error', 500, 'unexpected_failure'))).toBe(
      'unknown',
    );
  });
});

describe('currentUserId', () => {
  beforeEach(() => {
    auth.getSession.mockReset();
  });

  it('returns the user of the saved session', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });
    await expect(supabaseAuthService.currentUserId()).resolves.toBe('user-1');
  });

  it('returns null when no session is saved', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(supabaseAuthService.currentUserId()).resolves.toBeNull();
  });

  it('fails, instead of reporting signed out, when an expired session cannot be refreshed offline', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    await expect(supabaseAuthService.currentUserId()).rejects.toThrow(
      'Cannot refresh the saved session',
    );
  });

  it('returns null when the saved session was rejected by the server', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    });
    await expect(supabaseAuthService.currentUserId()).resolves.toBeNull();
  });
});

/** A Data API error answer. */
const answer = (code: string, message: string, status: number) => ({
  data: null,
  error: { code, message, details: null, hint: null },
  status,
});

/** A Data API answer with data. */
const ok = (data: unknown) => ({ data, error: null, status: 200 });

describe('loadIdentity', () => {
  beforeEach(() => {
    db.schema.mockReset();
    db.rpc.mockReset();
  });

  it('asks app.get_session_identity, the only read of who is signed in', async () => {
    db.rpc.mockResolvedValue(ok(null));
    await supabaseAuthService.loadIdentity();
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('get_session_identity');
  });

  it('an operator account, with whether it has a PIN', async () => {
    db.rpc.mockResolvedValue(
      ok({
        kind: 'operator',
        operator: { id: 'op-1', name: 'Giulia Prova', role: 'admin', has_pin: true },
      }),
    );
    await expect(supabaseAuthService.loadIdentity()).resolves.toEqual({
      kind: 'operator',
      operator: { id: 'op-1', name: 'Giulia Prova', role: 'admin' },
      hasPin: true,
    });
  });

  it('a device account without a cashier', async () => {
    db.rpc.mockResolvedValue(
      ok({
        kind: 'device',
        device: { id: 'dev-1', name: 'Tablet cassa' },
        cashier: null,
        turn_expires_at: null,
        lock_seconds_left: 0,
      }),
    );
    await expect(supabaseAuthService.loadIdentity()).resolves.toEqual({
      kind: 'device',
      device: { id: 'dev-1', name: 'Tablet cassa' },
      cashier: null,
      turnExpiresAt: null,
      lockSecondsLeft: 0,
    });
  });

  it('a device account with its cashier, the end of the turn and the lock as the server says', async () => {
    db.rpc.mockResolvedValue(
      ok({
        kind: 'device',
        device: { id: 'dev-1', name: 'Tablet cassa' },
        cashier: { id: 'op-2', name: 'Marco Prova', role: 'operator' },
        turn_expires_at: '2026-11-18T22:15:30.123456+00:00',
        lock_seconds_left: 42,
      }),
    );
    await expect(supabaseAuthService.loadIdentity()).resolves.toEqual({
      kind: 'device',
      device: { id: 'dev-1', name: 'Tablet cassa' },
      cashier: { id: 'op-2', name: 'Marco Prova', role: 'operator' },
      turnExpiresAt: new Date('2026-11-18T22:15:30.123Z'),
      lockSecondsLeft: 42,
    });
  });

  it('nobody: no profile and no device (removed, never linked)', async () => {
    db.rpc.mockResolvedValue(ok(null));
    await expect(supabaseAuthService.loadIdentity()).resolves.toBeNull();
  });

  it.each([
    ['an unknown kind', { kind: 'kiosk' }],
    [
      'an operator without has_pin',
      { kind: 'operator', operator: { id: 'op-1', name: 'G', role: 'admin' } },
    ],
    [
      'an operator with an unknown role',
      { kind: 'operator', operator: { id: 'op-1', name: 'G', role: 'owner', has_pin: false } },
    ],
    [
      'a device without its name',
      {
        kind: 'device',
        device: { id: 'dev-1' },
        cashier: null,
        turn_expires_at: null,
        lock_seconds_left: 0,
      },
    ],
    [
      'a cashier without the end of the turn',
      {
        kind: 'device',
        device: { id: 'dev-1', name: 'T' },
        cashier: { id: 'op-2', name: 'M', role: 'operator' },
        turn_expires_at: null,
        lock_seconds_left: 0,
      },
    ],
    [
      'an end of the turn that is not a timestamp',
      {
        kind: 'device',
        device: { id: 'dev-1', name: 'T' },
        cashier: { id: 'op-2', name: 'M', role: 'operator' },
        turn_expires_at: 'domani',
        lock_seconds_left: 0,
      },
    ],
    [
      'a lock that is not a whole number of seconds',
      {
        kind: 'device',
        device: { id: 'dev-1', name: 'T' },
        cashier: null,
        turn_expires_at: null,
        lock_seconds_left: 1.5,
      },
    ],
    [
      'a negative lock',
      {
        kind: 'device',
        device: { id: 'dev-1', name: 'T' },
        cashier: null,
        turn_expires_at: null,
        lock_seconds_left: -1,
      },
    ],
    ['a list', []],
  ])('an unexpected answer (%s) rejects, never guessed', async (_label, data) => {
    db.rpc.mockResolvedValue(ok(data));
    const error: unknown = await supabaseAuthService.loadIdentity().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ServerFaultError);
  });

  it.each([
    ['PGRST106', 'Invalid schema: app', 406, 'misconfigured'],
    ['42501', 'permission denied for schema app', 403, 'misconfigured'],
    ['42501', 'permission denied for function get_session_identity', 403, 'misconfigured'],
    [
      'PGRST202',
      'Could not find the function app.get_session_identity without parameters in the schema cache',
      404,
      'misconfigured',
    ],
    ['XX000', 'internal error', 500, 'misconfigured'],
    ['PGRST002', 'Could not query the database for the schema cache', 503, 'unavailable'],
  ] as const)('a server fault (%s, HTTP %i) says which', async (code, message, status, kind) => {
    db.rpc.mockResolvedValue(answer(code, message, status));
    const error: unknown = await supabaseAuthService.loadIdentity().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerFaultError);
    expect(error).toHaveProperty('kind', kind);
  });

  it('a failed fetch is a plain error (network)', async () => {
    db.rpc.mockResolvedValue(answer('', 'TypeError: Failed to fetch', 0));
    const error: unknown = await supabaseAuthService.loadIdentity().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ServerFaultError);
  });
});

/** An HTTP answer from Auth, as supabase-js reports it for each status. */
function httpError(status: number): AuthError {
  if (status >= 500) return new AuthRetryableFetchError(`HTTP ${status}`, status);
  if (status === 429)
    return new AuthApiError('Too many requests', 429, 'over_email_send_rate_limit');
  return new AuthApiError('Bad request', status, 'validation_failed');
}

const noResponse = () => new AuthRetryableFetchError('Failed to fetch', 0);

describe('requestPasswordReset', () => {
  const REDIRECT = 'http://localhost:4173/imposta-password';
  beforeEach(() => {
    auth.resetPasswordForEmail.mockReset();
  });

  it('asks Supabase for the recovery email with the given return address', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await expect(
      supabaseAuthService.requestPasswordReset('giulia@example.com', REDIRECT),
    ).resolves.toBe('sent');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('giulia@example.com', {
      redirectTo: REDIRECT,
    });
  });

  it.each([200, 400, 422, 429, 500, 502, 503, 504])(
    'reports "sent" for any HTTP answer (%i), so no answer reveals whether the account exists',
    async (status) => {
      auth.resetPasswordForEmail.mockResolvedValue(
        status === 200 ? { data: {}, error: null } : { data: null, error: httpError(status) },
      );
      await expect(
        supabaseAuthService.requestPasswordReset('x@example.com', REDIRECT),
      ).resolves.toBe('sent');
    },
  );

  it('reports "sent" for an answer whose body is not JSON', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: new AuthUnknownError('Unexpected token <', new SyntaxError('Unexpected token <')),
    });
    await expect(supabaseAuthService.requestPasswordReset('x@example.com', REDIRECT)).resolves.toBe(
      'sent',
    );
  });

  it('reports "network" only when no answer arrived (failed fetch, status 0)', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: noResponse() });
    await expect(supabaseAuthService.requestPasswordReset('x@example.com', REDIRECT)).resolves.toBe(
      'network',
    );
  });

  it('reports "network" when the call throws', async () => {
    auth.resetPasswordForEmail.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(supabaseAuthService.requestPasswordReset('x@example.com', REDIRECT)).resolves.toBe(
      'network',
    );
  });
});

describe('verifyRecovery', () => {
  beforeEach(() => {
    auth.verifyOtp.mockReset();
  });

  it('verifies the link token as a recovery', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
    await expect(supabaseAuthService.verifyRecovery('hash-1')).resolves.toBe('ok');
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'hash-1' });
  });

  it('expired or already used link', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: {},
      error: new AuthApiError('Email link is invalid or has expired', 403, 'otp_expired'),
    });
    await expect(supabaseAuthService.verifyRecovery('hash-1')).resolves.toBe('invalid-link');
  });

  it('any 403 is an invalid link', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: {},
      error: new AuthApiError('Forbidden', 403, undefined),
    });
    await expect(supabaseAuthService.verifyRecovery('hash-1')).resolves.toBe('invalid-link');
  });

  it('no answer', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: noResponse() });
    await expect(supabaseAuthService.verifyRecovery('hash-1')).resolves.toBe('network');
  });

  it('throwing call', async () => {
    auth.verifyOtp.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(supabaseAuthService.verifyRecovery('hash-1')).resolves.toBe('network');
  });

  it.each([429, 500, 504])('anything else (%i) is unknown', async (status) => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: httpError(status) });
    await expect(supabaseAuthService.verifyRecovery('hash-1')).resolves.toBe('unknown');
  });
});

describe('verifyInvite', () => {
  beforeEach(() => {
    auth.verifyOtp.mockReset();
  });

  it('verifies the link token as an invite', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
    await expect(supabaseAuthService.verifyInvite('hash-1')).resolves.toBe('ok');
    expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      type: 'invite',
      token_hash: 'hash-1',
    });
  });

  it('expired, used or replaced invite', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: {},
      error: new AuthApiError('Email link is invalid or has expired', 403, 'otp_expired'),
    });
    await expect(supabaseAuthService.verifyInvite('hash-1')).resolves.toBe('invalid-link');
  });

  it('no answer and throwing call', async () => {
    auth.verifyOtp.mockResolvedValueOnce({ data: {}, error: noResponse() });
    await expect(supabaseAuthService.verifyInvite('hash-1')).resolves.toBe('network');
    auth.verifyOtp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(supabaseAuthService.verifyInvite('hash-1')).resolves.toBe('network');
  });

  it.each([429, 500])('anything else (%i) is unknown', async (status) => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: httpError(status) });
    await expect(supabaseAuthService.verifyInvite('hash-1')).resolves.toBe('unknown');
  });
});

describe('updatePassword', () => {
  beforeEach(() => {
    auth.updateUser.mockReset();
  });

  it('saves the new password', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null });
    await expect(supabaseAuthService.updatePassword('nuova-password')).resolves.toBe('ok');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'nuova-password' });
  });

  it('same password as before', async () => {
    auth.updateUser.mockResolvedValue({
      data: {},
      error: new AuthApiError('New password should be different', 422, 'same_password'),
    });
    await expect(supabaseAuthService.updatePassword('vecchia-pw')).resolves.toBe('same-password');
  });

  it('too weak for the server', async () => {
    auth.updateUser.mockResolvedValue({
      data: {},
      error: new AuthWeakPasswordError('Password should be at least 8 characters', 422, ['length']),
    });
    await expect(supabaseAuthService.updatePassword('corta')).resolves.toBe('weak');
  });

  it('no answer', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: noResponse() });
    await expect(supabaseAuthService.updatePassword('nuova-password')).resolves.toBe('network');
  });

  it('throwing call', async () => {
    auth.updateUser.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(supabaseAuthService.updatePassword('nuova-password')).resolves.toBe('network');
  });

  it.each([401, 429, 500, 503])('anything else (%i) is unknown', async (status) => {
    auth.updateUser.mockResolvedValue({ data: {}, error: httpError(status) });
    await expect(supabaseAuthService.updatePassword('nuova-password')).resolves.toBe('unknown');
  });

  it('missing recovery session is unknown', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: new AuthSessionMissingError() });
    await expect(supabaseAuthService.updatePassword('nuova-password')).resolves.toBe('unknown');
  });
});

describe('currentEmail', () => {
  beforeEach(() => {
    auth.getSession.mockReset();
  });

  it('reads the email of the saved session', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1', email: 'giulia@example.com' } } },
      error: null,
    });
    await expect(supabaseAuthService.currentEmail()).resolves.toBe('giulia@example.com');
  });

  it('null without a session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(supabaseAuthService.currentEmail()).resolves.toBeNull();
  });

  it('null when the session cannot be refreshed (the form is only prefilled)', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: noResponse() });
    await expect(supabaseAuthService.currentEmail()).resolves.toBeNull();
  });
});

describe('signOutOtherDevices', () => {
  beforeEach(() => {
    auth.signOut.mockReset();
  });

  it('revokes the sessions of the other devices only', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await supabaseAuthService.signOutOtherDevices();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('ignores errors, returned or thrown', async () => {
    auth.signOut.mockResolvedValue({ error: noResponse() });
    await expect(supabaseAuthService.signOutOtherDevices()).resolves.toBeUndefined();
    auth.signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(supabaseAuthService.signOutOtherDevices()).resolves.toBeUndefined();
  });
});

describe('no sensitive data in logs', () => {
  it('never logs email, password or token, whatever the outcome', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    auth.resetPasswordForEmail.mockRejectedValue(new TypeError('Failed to fetch'));
    auth.verifyOtp.mockResolvedValue({ data: {}, error: httpError(500) });
    auth.updateUser.mockRejectedValue(new TypeError('Failed to fetch'));
    auth.signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    await supabaseAuthService.requestPasswordReset(
      'segreta@example.com',
      'http://x/imposta-password',
    );
    await supabaseAuthService.verifyRecovery('token-segreto');
    await supabaseAuthService.verifyInvite('token-segreto');
    await supabaseAuthService.updatePassword('password-segreta');
    await supabaseAuthService.signOutOtherDevices();
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
