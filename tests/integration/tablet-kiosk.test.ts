import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { localSupabase, memoryClient, runSql, runSqlInBackground } from './localSupabase';

// SPEC-tablet-kiosk through the API. Criterion 1: with its own token and no cashier the
// device reads 0 rows and every write is refused. Criterion 3: every RPC call is its own
// transaction, so the counter of wrong PINs must survive each answer, and concurrent
// attempts from one tablet must not slip past the fifth. Criterion 4: a new PIN closes the
// turn open on the tablet, even one racing it. No answer ever carries the PIN or its hash.
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
/** Seed accounts (supabase/seed.sql): signing in does not change them. */
const SEED_PASSWORD = 'password-di-prova';
/**
 * A customer with one purchase of this run: on a fresh database (CI) the seed has no movement,
 * and criterion 1 needs every table and view of app to have rows. Anonymized at the end.
 */
let seedAdminClient: SupabaseClient;
let ownCustomerId: string | undefined;
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

  // Customers and movements are never deleted: the seed operator records them, never the
  // throwaway operator whose profile is removed at the end.
  const seedOperator = await signedIn('operatore@example.com', SEED_PASSWORD);
  seedAdminClient = await signedIn('admin@example.com', SEED_PASSWORD);
  const created = await seedOperator.schema('app').rpc('create_customer', {
    p_operation_id: randomUUID(),
    p_name: `Cassa Movimento ${run}`,
    p_email: null,
    p_privacy_consent: true,
    p_notes: null,
  });
  if (created.error) throw created.error;
  const summary: unknown = created.data;
  if (typeof summary !== 'object' || summary === null || !('id' in summary)) {
    throw new Error('create_customer answered no customer');
  }
  ownCustomerId = String(summary.id);
  const purchase = await seedOperator.schema('app').rpc('record_purchase', {
    p_operation_id: randomUUID(),
    p_customer_id: ownCustomerId,
    p_amount_cents: 1250,
  });
  if (purchase.error) throw purchase.error;
});

afterAll(async () => {
  if (ownCustomerId) {
    await seedAdminClient.schema('app').rpc('anonymize_customer', { p_customer_id: ownCustomerId });
  }
  // Devices and profiles outlive their Auth users by design: remove them so other suites see the seed only.
  runSql(`delete from app.devices where name = :'name';`, { name: device.name });
  runSql(`delete from app.operators where name = :'name';`, { name: operator.name });
  await Promise.all(
    [operatorUserId, deviceUserId]
      .filter(Boolean)
      .map((id) => admin.auth.admin.deleteUser(id).catch(() => undefined)),
  );
});

/** Every table and view of app, read from the catalog so a new one is covered too. */
function appRelations(): { name: string; selectable: boolean }[] {
  return runSql(
    `select c.relname || '|' || has_table_privilege('authenticated', c.oid, 'select')
     from pg_class c
     where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
     order by c.relname;`,
  )
    .split('\n')
    .map((line) => {
      const [name = '', selectable] = line.split('|');
      return { name, selectable: selectable === 'true' };
    });
}

/** What the device token reads from each table and view: a row count, or the refusal. */
async function deviceReads(): Promise<string[]> {
  return Promise.all(
    appRelations().map(async ({ name }) => {
      const { data, error } = await deviceClient.schema('app').from(name).select('*');
      return error ? `${name}:${error.code}` : `${name}:${data.length}`;
    }),
  );
}

/** Rows of the tables a write would touch, counted as the database owner. */
function writeTargets(): string {
  return runSql(
    `select (select count(*) from app.customers) || '|' || (select count(*) from app.movements)
       || '|' || (select count(*) from app.cards) || '|' || (select count(*) from app.rewards)
       || '|' || (select row(s.*)::text from app.settings s);`,
  );
}

/** A seed row id, read as the database owner. */
function seedId(sql: string): string {
  const id = runSql(sql);
  if (!id) throw new Error(`The seed has no row for: ${sql}`);
  return id;
}

/** Write RPCs of the other modules, with the error each must answer a device without a cashier. */
function deviceWrites(): { name: string; args: Record<string, unknown>; code: string }[] {
  const customer = seedId(`select id from app.customers where anonymized_at is null limit 1;`);
  const reward = seedId(`select id from app.rewards limit 1;`);
  const movement = seedId(`select id from app.movements limit 1;`);
  const card = seedId(`select id from app.cards limit 1;`);
  return [
    {
      code: 'P0001',
      name: 'create_customer',
      args: {
        p_operation_id: randomUUID(),
        p_name: `Cassa Vuota ${run}`,
        p_email: null,
        p_privacy_consent: true,
        p_notes: null,
      },
    },
    {
      code: 'P0001',
      name: 'update_customer',
      args: { p_customer_id: customer, p_name: `Cassa Vuota ${run}`, p_email: null, p_notes: null },
    },
    { code: 'P0001', name: 'anonymize_customer', args: { p_customer_id: customer } },
    {
      code: 'P0001',
      name: 'associate_card',
      args: { p_customer_id: customer, p_uid: 'A0B1C2D3E4F5A9' },
    },
    { code: 'P0001', name: 'deactivate_card', args: { p_card_id: card } },
    { code: 'P0001', name: 'issue_card_link', args: { p_card_id: card } },
    {
      code: '42501',
      name: 'record_purchase',
      args: { p_operation_id: randomUUID(), p_customer_id: customer, p_amount_cents: 1250 },
    },
    {
      code: '42501',
      name: 'redeem_reward',
      args: { p_operation_id: randomUUID(), p_customer_id: customer, p_reward_id: reward },
    },
    {
      code: '42501',
      name: 'cancel_movement',
      args: { p_operation_id: randomUUID(), p_movement_id: movement },
    },
    {
      code: '42501',
      name: 'create_reward',
      args: { p_id: randomUUID(), p_name: `Premio Cassa ${run}`, p_points: 5, p_active: true },
    },
    { code: '42501', name: 'set_reward_active', args: { p_id: reward, p_active: false } },
    {
      code: '42501',
      name: 'update_settings',
      args: { p_cents_per_point: 100, p_confirm_threshold_cents: 15000, p_usb_uid_format: null },
    },
  ];
}

describe('a device without a cashier, with its own token (criterion 1)', () => {
  it('reads 0 rows from every table and view of app, and app.devices not at all', async () => {
    // As the database owner every relation has rows, so 0 below means hidden, not empty.
    const empty = appRelations().filter(
      ({ name }) => runSql(`select count(*) from app.${name};`) === '0',
    );
    expect(empty).toEqual([]);
    expect(deviceState()).toBe('0|none|none');

    const expected = appRelations().map(({ name, selectable }) =>
      selectable ? `${name}:0` : `${name}:42501`,
    );
    expect(await deviceReads()).toEqual(expected);
  });

  it('is refused by every write RPC and every direct write, and nothing changes', async () => {
    const before = writeTargets();

    const writes = deviceWrites();
    const answers = await Promise.all(
      writes.map(async ({ name, args }) => {
        const { error } = await deviceClient.schema('app').rpc(name, args);
        return `${name}:${error?.code ?? 'accepted'}`;
      }),
    );
    // The same refusals as for a caller without an operator (pgTAP tablet_kiosk_access).
    expect(answers).toEqual(writes.map(({ name, code }) => `${name}:${code}`));

    // The API role may only select from app: direct writes are refused before RLS.
    const directWrites = [
      deviceClient
        .schema('app')
        .from('customers')
        .insert({ name: `Diretto ${run}`, privacy_consent_at: new Date().toISOString() }),
      deviceClient.schema('app').from('settings').update({ cents_per_point: 1 }).eq('id', true),
      deviceClient
        .schema('app')
        .from('devices')
        .update({ failed_pin_attempts: 0, locked_until: null })
        .eq('name', device.name),
    ];
    for (const { error } of await Promise.all(directWrites)) expect(error?.code).toBe('42501');

    expect(writeTargets()).toBe(before);
  });

  it('reads with a cashier and reads nothing again once the turn ends', async () => {
    expect(await unlock(PIN)).toMatchObject({ status: 'ok' });
    const during = await deviceClient.schema('app').from('customers').select('id');
    expect(during.error).toBeNull();
    expect(during.data?.length).toBeGreaterThan(0);

    const { error } = await deviceClient.schema('app').rpc('end_cashier_turn');
    expect(error).toBeNull();
    expect(deviceState()).toBe('0|none|none');
    const after = await deviceClient.schema('app').from('customers').select('id');
    expect(after.error).toBeNull();
    expect(after.data).toEqual([]);
  });
});

describe('unlock_cashier through the API', () => {
  it('commits each wrong PIN with its answer', async () => {
    expect(await unlock(WRONG)).toEqual({ status: 'wrong_pin', attempts_left: 4 });
    expect(deviceState()).toBe('1|none|none');
    expect(await unlock(WRONG)).toEqual({ status: 'wrong_pin', attempts_left: 3 });
    expect(deviceState()).toBe('2|none|none');
  });

  it('counts 10 concurrent wrong PINs: exactly 5 counted, the fifth locks, the rest find the lock', async () => {
    runSql(`update app.devices set failed_pin_attempts = 0 where name = :'name';`, {
      name: device.name,
    });

    const answers = await Promise.all(Array.from({ length: 10 }, () => unlock(WRONG)));

    // Four counted attempts answer one distinct count each; the fifth sets the lock and
    // resets the counter, so a sixth counted attempt would show up as attempts_left 4 again.
    const wrong = answers.filter((a) => a.status === 'wrong_pin').map((a) => a.attempts_left);
    expect(wrong.toSorted((a = 0, b = 0) => a - b)).toEqual([1, 2, 3, 4]);
    const locked = answers.filter((a) => a.status === 'locked');
    expect(locked).toHaveLength(6);
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

describe('a new PIN from the phone (criterion 4)', () => {
  it('ends the turn open on the tablet: the device reads and writes nothing again', async () => {
    expect(await unlock(PIN)).toMatchObject({ status: 'ok' });
    expect(deviceState()).toBe(`0|none|${operatorId}`);

    const { error } = await operatorClient.schema('app').rpc('set_my_pin', { p_pin: PIN });
    expect(error).toBeNull();

    expect(deviceState()).toBe('0|none|none');
    const reads = await deviceClient.schema('app').from('customers').select('id');
    expect(reads.data).toEqual([]);
    const customer = seedId(`select id from app.customers where anonymized_at is null limit 1;`);
    const write = await deviceClient.schema('app').rpc('record_purchase', {
      p_operation_id: randomUUID(),
      p_customer_id: customer,
      p_amount_cents: 1250,
    });
    expect(write.error?.code).toBe('42501');
  });

  it('does not deadlock with an unlock of the same cashier on the same tablet', async () => {
    expect(await unlock(PIN)).toMatchObject({ status: 'ok' });
    expect(deviceState()).toBe(`0|none|${operatorId}`);

    // The unlock locks the device row first; the window before it reads the PIN row is
    // widened until set_my_pin is queued on a lock, so the two meet in the worst order.
    const claims = JSON.stringify({ sub: deviceUserId, role: 'authenticated' });
    const marker = `deadlock-${randomUUID()}`;
    const unlockInFlight = runSqlInBackground(
      `begin;
       select set_config('request.jwt.claims', :'claims', true);
       select 1 from app.devices where user_id = :'device'::uuid for update;
       do $$ /* ${marker} */
       begin
         for i in 1..250 loop
           perform pg_stat_clear_snapshot();
           if exists (
             select 1 from pg_stat_activity
             where pid <> pg_backend_pid() and wait_event_type = 'Lock'
               and query like '%set_my_pin%'
           ) then
             return;
           end if;
           perform pg_sleep(0.02);
         end loop;
         raise exception 'set_my_pin never queued behind the unlock';
       end $$;
       select app.unlock_cashier(:'operator'::uuid, :'pin') ->> 'status';
       commit;`,
      { claims, device: deviceUserId, operator: operatorId, pin: PIN },
    );
    // set_my_pin is sent only once the device row is locked and the unlock is waiting for it.
    await vi.waitFor(
      () => {
        const waiting = runSql(
          `select count(*) from pg_stat_activity
           where pid <> pg_backend_pid() and query like '%pg_stat_clear_snapshot%'
             and query like :'pattern';`,
          { pattern: `%${marker}%` },
        );
        if (waiting !== '1') throw new Error('The unlock does not hold the device row yet');
      },
      { timeout: 2000, interval: 20 },
    );

    const { error } = await operatorClient.schema('app').rpc('set_my_pin', { p_pin: PIN });
    const held = await unlockInFlight;

    expect(error).toBeNull();
    expect(held.split('\n')).toContain('ok');
    // The new PIN commits after that unlock, so it closes the turn the unlock opened.
    expect(deviceState()).toBe('0|none|none');
  });
});

/** Every key and every string value of an answer, however deep. */
function keysAndValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysAndValues);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysAndValues(inner)]);
  }
  if (typeof value === 'string') return [value];
  return typeof value === 'number' || typeof value === 'boolean' ? [String(value)] : [];
}

const app = (client: SupabaseClient) => client.schema('app');

describe('the PIN and its hash', () => {
  it('never appear in any answer of the API, in any state', async () => {
    const answers: unknown[] = [];
    const keep = (answer: { data: unknown; error: unknown }) => {
      answers.push(answer.data, answer.error);
      return answer;
    };

    keep(await app(operatorClient).rpc('set_my_pin', { p_pin: PIN }));
    keep(await app(operatorClient).rpc('get_session_identity'));
    keep(await app(operatorClient).from('operators').select('*'));
    keep(await app(operatorClient).rpc('list_cashiers'));
    keep(await app(deviceClient).rpc('list_cashiers'));
    keep(await app(deviceClient).rpc('get_session_identity'));
    keep(
      await app(deviceClient).rpc('unlock_cashier', { p_operator_id: operatorId, p_pin: WRONG }),
    );
    keep(await app(deviceClient).rpc('unlock_cashier', { p_operator_id: operatorId, p_pin: '12' }));
    keep(await app(deviceClient).rpc('unlock_cashier', { p_operator_id: operatorId, p_pin: PIN }));
    keep(await app(deviceClient).rpc('get_session_identity'));
    keep(await app(deviceClient).from('operators').select('*'));
    keep(await app(deviceClient).rpc('end_cashier_turn'));
    runSql(
      `update app.devices set locked_until = now() + interval '5 minutes' where name = :'name';`,
      { name: device.name },
    );
    keep(await app(deviceClient).rpc('unlock_cashier', { p_operator_id: operatorId, p_pin: PIN }));
    keep(await app(deviceClient).rpc('get_session_identity'));
    runSql(`update app.devices set locked_until = null where name = :'name';`, {
      name: device.name,
    });
    keep(await app(deviceClient).from('devices').select('*'));
    keep(await app(operatorClient).from('devices').select('*'));
    keep(await app(operatorClient).from('operator_pins').select('*'));
    keep(await operatorClient.schema('private').from('operator_pins').select('*'));
    keep(await deviceClient.schema('private').from('operator_pins').select('*'));

    // Precondition: the answers above are real, the cashier list and the unlock included.
    const everything = answers.flatMap(keysAndValues);
    expect(everything).toContain('has_pin');
    expect(everything).toContain('ok');
    expect(everything).toContain('locked');

    expect(everything.filter((text) => /pin_hash|\$2[aby]\$/.test(text))).toEqual([]);
    expect(everything).not.toContain(PIN);
    expect(everything).not.toContain(WRONG);
    // The hash is stored, and it is bcrypt of the PIN, not the PIN.
    expect(
      runSql(
        `select pin_hash like '$2_$08$%' and pin_hash = extensions.crypt(:'pin', pin_hash)
         from private.operator_pins where operator_id = :'id'::uuid;`,
        { pin: PIN, id: operatorId },
      ),
    ).toBe('t');
  });
});

/** Tracked files matching `git grep` arguments; git exits 1 when nothing matches. */
function trackedFilesMatching(...args: string[]): string[] {
  try {
    return execFileSync('git', ['grep', '-l', ...args], { encoding: 'utf8' })
      .trim()
      .split('\n');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 1) {
      return [];
    }
    throw error;
  }
}

describe('the local secret key', () => {
  it('is read at run time from `supabase status`, never written in a tracked file', () => {
    expect(trackedFilesMatching('-F', local.secretKey)).toEqual([]);
  });

  it('is only used by the integration tests (E2E and the app get the publishable key only)', () => {
    const readers = trackedFilesMatching('-F', 'secretKey');
    // The one exception: the Edge Function reads its own secret key from the Edge runtime
    // environment (SPEC-operators point 5), only in index.ts, never in handler.ts or the app.
    expect(readers.filter((path) => !path.startsWith('tests/integration/'))).toEqual([
      'supabase/functions/operator-invites/index.ts',
    ]);
  });
});
