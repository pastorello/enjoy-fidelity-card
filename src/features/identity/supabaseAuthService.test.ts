import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signInResultFor, supabaseAuthService } from './supabaseAuthService';

const auth = vi.hoisted(() => ({ getSession: vi.fn<() => Promise<unknown>>() }));
vi.mock('../../lib/supabase', () => ({ getSupabase: () => ({ auth }) }));

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
  beforeEach(() => auth.getSession.mockReset());

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
