import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { supabaseCustomerService as customers } from '../../src/features/customers/supabaseCustomerService';
import { supabaseLedgerService as service } from '../../src/features/ledger/supabaseLedgerService';
import type { LedgerResult } from '../../src/features/ledger/types';
import { localSupabase, memoryClient, runSql, runSqlInBackground } from './localSupabase';

// The service under test talks to whichever signed-in client was selected when it was called:
// it reads the client synchronously, so two calls in flight can belong to two accounts.
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
// Customers and movements are never deleted: every run uses names of its own.
const SUFFIX = randomBytes(4).toString('hex');
// A race is microseconds wide: 20 rounds, each on a fresh customer (SPEC-ledger, criterion 5).
const ROUNDS = 20;
// How long a held lock keeps the requests queued behind it.
const HOLD_SECONDS = 1;

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = memoryClient(local.url, local.publishableKey);
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

let adminClient: SupabaseClient;
let operatorClient: SupabaseClient;

/** Calls `call` with `client` as the signed-in account. */
function as<T>(client: SupabaseClient, call: () => Promise<T>): Promise<T> {
  current.client = client;
  return call();
}

/** Customers this run made: anonymized at the end, so they leave Serviti oggi and the search. */
const toErase: string[] = [];

/** The ratio in force: amounts are computed from it, never assumed to be 100. */
function centsPerPoint(): number {
  return Number(runSql(`select cents_per_point from app.settings;`));
}

/** The balance by the database's own definition: the sum of every movement. */
function balanceOf(customerId: string): number {
  return Number(runSql(`select private.customer_balance(:'id'::uuid);`, { id: customerId }));
}

function countOf(sql: string, customerId: string): number {
  return Number(runSql(sql, { id: customerId }));
}

/** A fresh customer with a single purchase worth exactly 100 points, made by the operator. */
async function customerWith100Points(label: string): Promise<{ id: string; purchase: string }> {
  const created = await as(operatorClient, () =>
    customers.create({
      operationId: randomUUID(),
      name: `Ledger ${label} ${SUFFIX}`,
      phone: '',
      privacyConsent: true,
      notes: '',
    }),
  );
  toErase.push(created.id);
  const result = await as(operatorClient, () =>
    service.recordPurchase({
      operationId: randomUUID(),
      customerId: created.id,
      amountCents: 100 * centsPerPoint(),
    }),
  );
  expect(result.balance).toBe(100);
  return { id: created.id, purchase: result.movement.id };
}

/** Runs `round` ROUNDS times, one after the other, so every round is a fresh race. */
async function rounds(round: (index: number) => Promise<void>, index = 0): Promise<void> {
  if (index === ROUNDS) return;
  await round(index);
  await rounds(round, index + 1);
}

/** The outcome of a settled ledger call: the result, or the kind it was refused with. */
function outcome(settled: PromiseSettledResult<LedgerResult>): LedgerResult | string {
  if (settled.status === 'fulfilled') return settled.value;
  const reason: unknown = settled.reason;
  return typeof reason === 'object' && reason !== null && 'kind' in reason
    ? String(reason.kind)
    : String(reason);
}

/** Exactly one call succeeded and the other was refused with insufficient-balance. */
function expectOneWinner(settled: PromiseSettledResult<LedgerResult>[]): LedgerResult {
  const outcomes = settled.map(outcome);
  const winners = outcomes.filter((value) => typeof value !== 'string');
  const losers = outcomes.filter((value) => typeof value === 'string');
  expect(losers).toEqual(['insufficient-balance']);
  expect(winners).toHaveLength(1);
  const [winner] = winners;
  if (!winner) throw new Error('No winner');
  return winner;
}

/**
 * Locks the customer's row in a transaction kept open for HOLD_SECONDS; resolves once the lock
 * is held. `released` settles when the transaction has committed.
 */
async function holdCustomerLock(customerId: string) {
  const marker = `hold-${randomUUID()}`;
  const released = runSqlInBackground(
    `begin;
     select 1 from app.customers where id = :'id'::uuid for update;
     select pg_sleep(${HOLD_SECONDS}) /* ${marker} */;
     commit;`,
    { id: customerId },
  );
  await vi.waitFor(
    () => {
      const sleeping = runSql(
        `select count(*) from pg_stat_activity
         where pid <> pg_backend_pid() and query like '%pg_sleep%' and query like :'pattern';`,
        { pattern: `%${marker}%` },
      );
      if (sleeping !== '1') throw new Error('The customer lock is not held yet');
    },
    { timeout: 2000, interval: 20 },
  );
  return { released };
}

/** Waits until `count` requests are blocked on a lock: proof that they are in flight together. */
async function waitForBlocked(count: number) {
  await vi.waitFor(
    () => {
      const blocked = Number(
        runSql(
          `select count(*) from pg_stat_activity
           where pid <> pg_backend_pid() and wait_event_type = 'Lock';`,
        ),
      );
      if (blocked < count) throw new Error(`${blocked} of ${count} requests are waiting`);
    },
    { timeout: 2000, interval: 20 },
  );
}

/** A free reward of 60 points, redeemed by `client`. */
const redeem60 = (client: SupabaseClient, customerId: string) =>
  as(client, () =>
    service.redeemFreeReward({
      operationId: randomUUID(),
      customerId,
      description: 'Premio libero di prova',
      points: 60,
    }),
  );

/** The operator redeems 60 points while the admin cancels the purchase of 100. */
const redeemOrCancel = (customer: { id: string; purchase: string }) => [
  as(operatorClient, () =>
    service.redeemFreeReward({
      operationId: randomUUID(),
      customerId: customer.id,
      description: 'Premio libero di prova',
      points: 60,
    }),
  ),
  as(adminClient, () =>
    service.cancelMovement({ operationId: randomUUID(), movementId: customer.purchase }),
  ),
];

/** A purchase of 12,50 € by the operator with a given operation_id. */
const samePurchase = (operationId: string, customerId: string) =>
  as(operatorClient, () => service.recordPurchase({ operationId, customerId, amountCents: 1250 }));

beforeAll(async () => {
  adminClient = await signedIn('admin@example.com');
  operatorClient = await signedIn('operatore@example.com');
});

afterAll(async () => {
  current.client = adminClient;
  await Promise.all(toErase.map((id) => customers.anonymize(id)));
});

describe('two redemptions of 60 on a balance of 100 (criterion 5)', () => {
  it(`admin and operator at once, ${ROUNDS} rounds: always one wins, the balance stays >= 0`, async () => {
    await rounds(async (index) => {
      const customer = await customerWith100Points(`riscatti ${index}`);
      const settled = await Promise.allSettled([
        redeem60(adminClient, customer.id),
        redeem60(operatorClient, customer.id),
      ]);
      const winner = expectOneWinner(settled);
      expect(winner.balance).toBe(40);
      expect(balanceOf(customer.id)).toBe(40);
      expect(
        countOf(
          `select count(*) from app.movements where customer_id = :'id'::uuid and kind = 'redemption';`,
          customer.id,
        ),
      ).toBe(1);
    });
  });

  it('both queued behind the customer lock: the second sees the first and is refused', async () => {
    const customer = await customerWith100Points('riscatti in coda');
    const { released } = await holdCustomerLock(customer.id);
    const calls = Promise.allSettled([
      redeem60(adminClient, customer.id),
      redeem60(operatorClient, customer.id),
    ]);
    await waitForBlocked(2);
    await released;
    expectOneWinner(await calls);
    expect(balanceOf(customer.id)).toBe(40);
  });
});

describe('a redemption of 60 and the admin cancelling the purchase of 100 (criterion 5)', () => {
  it(`${ROUNDS} rounds: always one wins, the balance stays >= 0`, async () => {
    await rounds(async (index) => {
      const customer = await customerWith100Points(`annullo ${index}`);
      const winner = expectOneWinner(await Promise.allSettled(redeemOrCancel(customer)));
      // The redemption leaves 40; the correction of the purchase leaves 0.
      const expected = winner.movement.kind === 'redemption' ? 40 : 0;
      expect(winner.balance).toBe(expected);
      expect(balanceOf(customer.id)).toBe(expected);
      expect(
        countOf(
          `select count(*) from app.movements where customer_id = :'id'::uuid and kind <> 'purchase';`,
          customer.id,
        ),
      ).toBe(1);
    });
  });

  it('both queued behind the customer lock: exactly one goes through', async () => {
    const customer = await customerWith100Points('annullo in coda');
    const { released } = await holdCustomerLock(customer.id);
    const calls = Promise.allSettled(redeemOrCancel(customer));
    await waitForBlocked(2);
    await released;
    expectOneWinner(await calls);
    expect(balanceOf(customer.id)).toBeGreaterThanOrEqual(0);
  });
});

describe('two parallel calls with the same operation_id (criterion 4)', () => {
  it(`${ROUNDS} rounds: one movement, both answers carry it`, async () => {
    await rounds(async (index) => {
      const customer = await customerWith100Points(`stesso id ${index}`);
      const operationId = randomUUID();
      const [first, second] = await Promise.all([
        samePurchase(operationId, customer.id),
        samePurchase(operationId, customer.id),
      ]);
      expect(second.movement).toEqual(first.movement);
      expect(first.movement.operationId).toBe(operationId);
      expect(
        Number(
          runSql(`select count(*) from app.movements where operation_id = :'op'::uuid;`, {
            op: operationId,
          }),
        ),
      ).toBe(1);
    });
  });

  it('both queued behind the customer lock: the second is a replay of the first', async () => {
    const customer = await customerWith100Points('stesso id in coda');
    const operationId = randomUUID();
    const { released } = await holdCustomerLock(customer.id);
    const calls = Promise.all([
      samePurchase(operationId, customer.id),
      samePurchase(operationId, customer.id),
    ]);
    await waitForBlocked(2);
    await released;
    const [first, second] = await calls;
    expect(second.movement.id).toBe(first.movement.id);
    expect(
      Number(
        runSql(`select count(*) from app.movements where operation_id = :'op'::uuid;`, {
          op: operationId,
        }),
      ),
    ).toBe(1);
    expect(balanceOf(customer.id)).toBe(100 + Math.floor(1250 / centsPerPoint()));
  });
});
