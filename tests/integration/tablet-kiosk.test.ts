import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { localSupabase, memoryClient, runSql, runSqlInBackground } from './localSupabase';

// SPEC-tablet-kiosk, criterion 3, through the API: every RPC call is its own transaction,
// so the counter of wrong PINs must survive each answer, and concurrent attempts from one
// tablet must not slip past the fifth. A new PIN racing an unlock never leaves a turn
// opened with the old PIN (criterion 4).
const local = localSupabase();
const admin = memoryClient(local.url, local.secretKey);

/** Throwaway accounts, so the seed devices and operators used by E2E are never touched. */
const run = randomUUID().slice(0, 8);
const operator = {
  email: `pin-integrazione-${run}@example.com`,
  name: `Pin Integrazione ${run}`,
  password: randomBytes(18).toString('base64url'),
};
const device = {
  email: `tablet-integrazione-${run}@example.com`,
  name: `Tablet Integrazione ${run}`,
  password: randomBytes(18).toString('base64url'),
};
// A fake PIN; the wrong one differs from it.
const PIN = '4826';
const WRONG = '1111';
let operatorUserId: string;
let deviceUserId: string;
let operatorId: string;
let operatorClient: SupabaseClient;
let deviceClient: SupabaseClient;
// How long a transaction held open in psql keeps the API call queued behind it.
const HOLD_SECONDS = 1;

async function createUser(email: string, password: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const client = memoryClient(local.url, local.publishableKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

/** What unlock_cashier answers (SPEC-tablet-kiosk, "Modello dati e regole di accesso"). */
type UnlockAnswer = {
  status: string;
  attempts_left?: number;
  lock_seconds_left?: number;
  turn_expires_at?: string;
  cashier?: { id: string; name: string; role: string };
};

function isUnlockAnswer(value: unknown): value is UnlockAnswer {
  return typeof value === 'object' && value !== null && 'status' in value;
}

async function unlock(pin: string): Promise<UnlockAnswer> {
  const { data, error } = await deviceClient.schema('app').rpc('unlock_cashier', {
    p_operator_id: operatorId,
    p_pin: pin,
  });
  if (error) throw error;
  if (!isUnlockAnswer(data)) throw new Error(`Unexpected answer: ${JSON.stringify(data)}`);
  return data;
}

/** The device row as committed, read from another session. */
function deviceState(): string {
  return runSql(
    `select failed_pin_attempts || '|' || coalesce((locked_until > now())::text, 'none') || '|'
       || coalesce(cashier_operator_id::text, 'none')
     from app.devices where name = :'name';`,
    { name: device.name },
  );
}

/**
 * Runs `call` in a psql transaction as the Auth user `userId` and keeps the transaction open
 * for HOLD_SECONDS; resolves once the call is done and the transaction is waiting.
 */
async function holdOpen(userId: string, call: string, vars: Record<string, string>) {
  const marker = `hold-${randomUUID()}`;
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  const released = runSqlInBackground(
    `begin;
     select set_config('request.jwt.claims', :'claims', true);
     ${call};
     select pg_sleep(${HOLD_SECONDS}) /* ${marker} */;
     commit;`,
    { ...vars, claims },
  );
  await vi.waitFor(
    () => {
      const sleeping = runSql(
        `select count(*) from pg_stat_activity
         where pid <> pg_backend_pid() and query like '%pg_sleep%' and query like :'pattern';`,
        { pattern: `%${marker}%` },
      );
      if (sleeping !== '1') throw new Error('The transaction is not held open yet');
    },
    { timeout: 2000, interval: 20 },
  );
  return { released };
}

beforeAll(async () => {
  operatorUserId = await createUser(operator.email, operator.password);
  deviceUserId = await createUser(device.email, device.password);
  operatorId = runSql(`select private.add_operator(:'email', :'name', 'operator');`, {
    email: operator.email,
    name: operator.name,
  });
  runSql(`select private.add_device(:'email', :'name');`, {
    email: device.email,
    name: device.name,
  });

  operatorClient = await signedIn(operator.email, operator.password);
  const { error } = await operatorClient.schema('app').rpc('set_my_pin', { p_pin: PIN });
  if (error) throw error;
  deviceClient = await signedIn(device.email, device.password);
});

afterAll(async () => {
  // Devices and profiles outlive their Auth users by design: remove them so other suites see the seed only.
  runSql(`delete from app.devices where name = :'name';`, { name: device.name });
  runSql(`delete from app.operators where name = :'name';`, { name: operator.name });
  await Promise.all(
    [operatorUserId, deviceUserId]
      .filter(Boolean)
      .map((id) => admin.auth.admin.deleteUser(id).catch(() => undefined)),
  );
});

describe('unlock_cashier through the API', () => {
  it('commits each wrong PIN with its answer', async () => {
    expect(await unlock(WRONG)).toEqual({ status: 'wrong_pin', attempts_left: 4 });
    expect(deviceState()).toBe('1|none|none');
    expect(await unlock(WRONG)).toEqual({ status: 'wrong_pin', attempts_left: 3 });
    expect(deviceState()).toBe('2|none|none');
  });

  it('counts concurrent attempts one by one: the fifth locks, the rest find the lock', async () => {
    runSql(`update app.devices set failed_pin_attempts = 0 where name = :'name';`, {
      name: device.name,
    });

    const answers = await Promise.all(Array.from({ length: 8 }, () => unlock(WRONG)));

    const wrong = answers.filter((a) => a.status === 'wrong_pin').map((a) => a.attempts_left);
    expect(wrong.toSorted((a = 0, b = 0) => a - b)).toEqual([1, 2, 3, 4]);
    const locked = answers.filter((a) => a.status === 'locked');
    expect(locked).toHaveLength(4);
    for (const answer of locked) {
      expect(answer.lock_seconds_left).toBeGreaterThan(0);
      expect(answer.lock_seconds_left).toBeLessThanOrEqual(300);
    }
    expect(deviceState()).toBe('0|true|none');
  });

  it('keeps the lock across requests even for the right PIN, then unlocks once it has passed', async () => {
    expect(await unlock(PIN)).toMatchObject({ status: 'locked' });
    expect(deviceState()).toBe('0|true|none');

    runSql(
      `update app.devices set locked_until = now() - interval '1 second' where name = :'name';`,
      { name: device.name },
    );
    const answer = await unlock(PIN);
    expect(answer).toMatchObject({
      status: 'ok',
      cashier: { id: operatorId, name: operator.name, role: 'operator' },
    });
    expect(Date.parse(String(answer.turn_expires_at)) - Date.now()).toBeGreaterThan(
      11.9 * 3600_000,
    );
    expect(deviceState()).toBe(`0|none|${operatorId}`);

    const { error } = await deviceClient.schema('app').rpc('end_cashier_turn');
    expect(error).toBeNull();
    expect(deviceState()).toBe('0|none|none');
  });

  it('an unlock waiting for a new PIN checks the new PIN, not the old one', async () => {
    const { released } = await holdOpen(operatorUserId, `select app.set_my_pin('7390')`, {});

    const answer = await unlock(PIN);
    await released;

    expect(answer).toEqual({ status: 'wrong_pin', attempts_left: 4 });
    expect(deviceState()).toBe('1|none|none');
    expect(await unlock('7390')).toMatchObject({ status: 'ok' });
  });

  it('a new PIN set while an unlock is in flight closes the turn that unlock opened', async () => {
    // No committed turn: only the in-flight unlock opens one.
    const { error: endError } = await deviceClient.schema('app').rpc('end_cashier_turn');
    expect(endError).toBeNull();
    expect(deviceState()).toBe('0|none|none');

    const { released } = await holdOpen(
      deviceUserId,
      `select app.unlock_cashier(:'operator'::uuid, '7390') ->> 'status'`,
      { operator: operatorId },
    );

    const { error } = await operatorClient.schema('app').rpc('set_my_pin', { p_pin: PIN });
    const held = await released;

    expect(held.split('\n')).toContain('ok');
    expect(error).toBeNull();
    expect(deviceState()).toBe('0|none|none');
  });
});
