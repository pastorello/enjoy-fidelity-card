import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { supabaseSettingsService } from '../../src/features/settings/supabaseSettingsService';
import { localSupabase, memoryClient, runSql } from './localSupabase';

// The service under test talks to whichever signed-in client the test sets here.
const current = vi.hoisted(() => ({ client: undefined as SupabaseClient | undefined }));
vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => {
    if (!current.client) throw new Error('No client selected for this test');
    return current.client;
  },
}));

const local = localSupabase();
// Seed accounts (supabase/seed.sql): signing in does not change them.
const SEED_PASSWORD = 'password-di-prova';

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = memoryClient(local.url, local.publishableKey);
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

/** The row as stored, read as the database owner (bypassing row-level security). */
function storedRow(): string {
  return runSql(
    `select cents_per_point || '/' || confirm_threshold_cents || '/' || usb_uid_format
     from app.settings;`,
  );
}

let adminClient: SupabaseClient;
let operatorClient: SupabaseClient;
/** `updated_at` and `updated_by` before this suite, as text ('' for null). */
let stamp: { at: string; by: string };

beforeAll(async () => {
  adminClient = await signedIn('admin@example.com');
  operatorClient = await signedIn('operatore@example.com');
  const initial = storedRow();
  if (initial !== '100/15000/hex') {
    throw new Error(`Expected the initial settings, found ${initial}: run \`npm run db:reset\`.`);
  }
  const [at = '', by = ''] = runSql(
    `select updated_at::text || '|' || coalesce(updated_by::text, '') from app.settings;`,
  ).split('|');
  stamp = { at, by };
});

afterAll(async () => {
  // Leave the initial configuration for the other suites, even after a failure: first as the
  // admin would, then put back who/when, so the row is exactly as this suite found it.
  current.client = adminClient;
  const result = await supabaseSettingsService.update({
    centsPerPoint: 100,
    confirmThresholdCents: 15000,
  });
  runSql(
    `update app.settings
     set updated_at = :'at'::timestamptz, updated_by = nullif(:'by', '')::uuid;`,
    stamp,
  );
  if (result.status !== 'ok' || storedRow() !== '100/15000/hex') {
    throw new Error(`Could not restore the initial settings (${result.status}).`);
  }
});

describe('operator', () => {
  beforeAll(() => {
    current.client = operatorClient;
  });

  it('reads the configuration', async () => {
    await expect(supabaseSettingsService.load()).resolves.toMatchObject({
      centsPerPoint: 100,
      confirmThresholdCents: 15000,
      usbUidFormat: 'hex',
    });
  });

  it('is refused by update_settings with 42501 (forbidden), and nothing changes', async () => {
    const raw = await operatorClient
      .schema('app')
      .rpc('update_settings', { p_cents_per_point: 1, p_confirm_threshold_cents: 1 });
    expect(raw.error?.code).toBe('42501');

    await expect(
      supabaseSettingsService.update({ centsPerPoint: 1, confirmThresholdCents: 1 }),
    ).resolves.toEqual({ status: 'forbidden' });
    expect(storedRow()).toBe('100/15000/hex');
  });

  it('cannot change the row with a direct update', async () => {
    await operatorClient
      .schema('app')
      .from('settings')
      .update({ cents_per_point: 1, confirm_threshold_cents: 1 })
      .eq('id', true);
    expect(storedRow()).toBe('100/15000/hex');
  });
});

describe('admin', () => {
  beforeAll(() => {
    current.client = adminClient;
  });

  it('saves both values, reads them back, then restores 100 / 15000', async () => {
    const saved = await supabaseSettingsService.update({
      centsPerPoint: 200,
      confirmThresholdCents: 20000,
    });
    expect(saved).toMatchObject({
      status: 'ok',
      settings: { centsPerPoint: 200, confirmThresholdCents: 20000, usbUidFormat: 'hex' },
    });
    await expect(supabaseSettingsService.load()).resolves.toMatchObject({
      centsPerPoint: 200,
      confirmThresholdCents: 20000,
      usbUidFormat: 'hex',
    });
    // The other phones see it too.
    current.client = operatorClient;
    await expect(supabaseSettingsService.load()).resolves.toMatchObject({ centsPerPoint: 200 });
    current.client = adminClient;

    const restored = await supabaseSettingsService.update({
      centsPerPoint: 100,
      confirmThresholdCents: 15000,
    });
    expect(restored).toMatchObject({ status: 'ok', settings: { centsPerPoint: 100 } });
    expect(storedRow()).toBe('100/15000/hex');
  });

  it('values outside the limits are invalid (22023), and nothing changes', async () => {
    await expect(
      supabaseSettingsService.update({ centsPerPoint: 10001, confirmThresholdCents: 15000 }),
    ).resolves.toEqual({ status: 'invalid' });
    await expect(
      supabaseSettingsService.update({ centsPerPoint: 100, confirmThresholdCents: 0 }),
    ).resolves.toEqual({ status: 'invalid' });
    expect(storedRow()).toBe('100/15000/hex');
  });
});

describe('without an active profile', () => {
  // A throwaway Auth user with no operator profile, so the seed accounts are never touched.
  const email = `senza-profilo-${randomUUID()}@example.com`;
  const password = randomBytes(18).toString('base64url');
  const secret = memoryClient(local.url, local.secretKey);
  let userId: string | undefined;

  beforeAll(async () => {
    const { data, error } = await secret.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  });

  afterAll(async () => {
    if (userId) await secret.auth.admin.deleteUser(userId);
  });

  it('a signed-in user without a profile sees no row: not-found, distinct from network', async () => {
    const client = memoryClient(local.url, local.publishableKey);
    const { error } = await client.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    current.client = client;
    await expect(supabaseSettingsService.load()).rejects.toMatchObject({ kind: 'not-found' });
    await expect(
      supabaseSettingsService.update({ centsPerPoint: 1, confirmThresholdCents: 1 }),
    ).resolves.toEqual({ status: 'forbidden' });
    expect(storedRow()).toBe('100/15000/hex');
  });

  it('anon (no session) cannot read the row either', async () => {
    current.client = memoryClient(local.url, local.publishableKey);
    // No select privilege for anon: a permission error, never data.
    await expect(supabaseSettingsService.load()).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('a server that cannot be reached is network', async () => {
    // Port 9 (discard) on the loopback: nothing listens there, the fetch fails at once.
    current.client = memoryClient('http://127.0.0.1:9', local.publishableKey);
    await expect(
      supabaseSettingsService.update({ centsPerPoint: 100, confirmThresholdCents: 15000 }),
    ).resolves.toEqual({ status: 'network' });
  });
});
