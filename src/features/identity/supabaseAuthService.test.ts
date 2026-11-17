import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { signInResultFor } from './supabaseAuthService';

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
