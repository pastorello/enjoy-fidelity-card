import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../src/lib/serverFault';
import { supabaseCustomerService as customers } from '../../src/features/customers/supabaseCustomerService';
import { supabaseLedgerService as service } from '../../src/features/ledger/supabaseLedgerService';
import { localSupabase, memoryClient, runSql } from './localSupabase';

// The service under test talks to whichever signed-in client was selected when it was called.
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
// Seed rewards (supabase/seed.sql), never modified by tests.
const INACTIVE_REWARD = 'e0000000-0000-4000-8000-000000000003';
const ACTIVE_REWARD_50 = 'e0000000-0000-4000-8000-000000000001';

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

/** Customers this run made: anonymized at the end. */
const toErase: string[] = [];

function centsPerPoint(): number {
  return Number(runSql(`select cents_per_point from app.settings;`));
}

async function newCustomer(label: string): Promise<string> {
  const created = await as(operatorClient, () =>
    customers.create({
      operationId: randomUUID(),
      name: `Ledger codici ${label} ${SUFFIX}`,
      phone: '',
      email: '',
      privacyConsent: true,
      notes: '',
    }),
  );
  toErase.push(created.id);
  return created.id;
}

/** A purchase worth `points` points, computed from the ratio in force. */
function purchase(client: SupabaseClient, customerId: string, points: number) {
  return as(client, () =>
    service.recordPurchase({
      operationId: randomUUID(),
      customerId,
      amountCents: points * centsPerPoint(),
    }),
  );
}

beforeAll(async () => {
  adminClient = await signedIn('admin@example.com');
  operatorClient = await signedIn('operatore@example.com');
});

afterAll(async () => {
  current.client = adminClient;
  await Promise.all(toErase.map((id) => customers.anonymize(id)));
});

describe('the real answers of the server', () => {
  it('a purchase rounds down and saves the ratio in force; the balance is the sum', async () => {
    const customerId = await newCustomer('spesa');
    const ratio = centsPerPoint();
    const result = await as(operatorClient, () =>
      service.recordPurchase({ operationId: randomUUID(), customerId, amountCents: 3 * ratio - 1 }),
    );
    expect(result.movement).toMatchObject({
      kind: 'purchase',
      customerId,
      amountCents: 3 * ratio - 1,
      points: 2,
      centsPerPoint: ratio,
      operatorName: 'Operatore Prova',
    });
    expect(result.balance).toBe(2);
  });

  it('a catalog redemption reads points and name from the server', async () => {
    const customerId = await newCustomer('catalogo');
    await purchase(operatorClient, customerId, 60);
    const result = await as(operatorClient, () =>
      service.redeemReward({ operationId: randomUUID(), customerId, rewardId: ACTIVE_REWARD_50 }),
    );
    expect(result.movement).toMatchObject({
      kind: 'redemption',
      points: -50,
      rewardId: ACTIVE_REWARD_50,
      description: 'Caffè',
    });
    expect(result.balance).toBe(10);
  });

  it('a cancel inserts a correction and the history shows who cancelled the movement', async () => {
    const customerId = await newCustomer('storico');
    const bought = await purchase(operatorClient, customerId, 30);
    const correction = await as(adminClient, () =>
      service.cancelMovement({ operationId: randomUUID(), movementId: bought.movement.id }),
    );
    expect(correction.movement).toMatchObject({
      kind: 'correction',
      points: -30,
      correctsMovementId: bought.movement.id,
      correctedKind: 'purchase',
    });
    expect(correction.balance).toBe(0);
    const history = await as(operatorClient, () => service.listMovements(customerId));
    expect(history.map((movement) => movement.kind)).toEqual(['correction', 'purchase']);
    expect(history[1]).toMatchObject({ cancelledById: correction.movement.operatorId });
  });
});

describe('every server code becomes its LedgerError kind', () => {
  it('EC001 insufficient-balance: a redemption above the balance', async () => {
    const customerId = await newCustomer('ec001');
    await purchase(operatorClient, customerId, 10);
    await expect(
      as(operatorClient, () =>
        service.redeemFreeReward({
          operationId: randomUUID(),
          customerId,
          description: 'Oltre il saldo',
          points: 11,
        }),
      ),
    ).rejects.toMatchObject({ name: 'LedgerError', kind: 'insufficient-balance' });
  });

  it('EC001 insufficient-balance: cancelling a purchase whose points are spent', async () => {
    const customerId = await newCustomer('ec001 annullo');
    const bought = await purchase(operatorClient, customerId, 10);
    await as(operatorClient, () =>
      service.redeemFreeReward({
        operationId: randomUUID(),
        customerId,
        description: 'Spende i punti',
        points: 10,
      }),
    );
    await expect(
      as(adminClient, () =>
        service.cancelMovement({ operationId: randomUUID(), movementId: bought.movement.id }),
      ),
    ).rejects.toMatchObject({ kind: 'insufficient-balance' });
  });

  it('EC002 already-cancelled: a second cancel with a new id', async () => {
    const customerId = await newCustomer('ec002');
    const bought = await purchase(operatorClient, customerId, 10);
    await as(adminClient, () =>
      service.cancelMovement({ operationId: randomUUID(), movementId: bought.movement.id }),
    );
    await expect(
      as(adminClient, () =>
        service.cancelMovement({ operationId: randomUUID(), movementId: bought.movement.id }),
      ),
    ).rejects.toMatchObject({ kind: 'already-cancelled' });
  });

  it("EC003 cancel-window-expired: the operator cancelling someone else's movement", async () => {
    const customerId = await newCustomer('ec003');
    const bought = await purchase(adminClient, customerId, 10);
    await expect(
      as(operatorClient, () =>
        service.cancelMovement({ operationId: randomUUID(), movementId: bought.movement.id }),
      ),
    ).rejects.toMatchObject({ kind: 'cancel-window-expired' });
  });

  it('the operator cancels their own movement just registered', async () => {
    const customerId = await newCustomer('proprio');
    const bought = await purchase(operatorClient, customerId, 10);
    await expect(
      as(operatorClient, () =>
        service.cancelMovement({ operationId: randomUUID(), movementId: bought.movement.id }),
      ),
    ).resolves.toMatchObject({ balance: 0, movement: { kind: 'correction' } });
  });

  it('EC004 not-cancellable: cancelling a correction', async () => {
    const customerId = await newCustomer('ec004');
    const bought = await purchase(operatorClient, customerId, 10);
    const correction = await as(adminClient, () =>
      service.cancelMovement({ operationId: randomUUID(), movementId: bought.movement.id }),
    );
    await expect(
      as(adminClient, () =>
        service.cancelMovement({ operationId: randomUUID(), movementId: correction.movement.id }),
      ),
    ).rejects.toMatchObject({ kind: 'not-cancellable' });
  });

  it('EC005 reward-unavailable: an inactive reward and an unknown one', async () => {
    const customerId = await newCustomer('ec005');
    await purchase(operatorClient, customerId, 500);
    const refusals = [INACTIVE_REWARD, randomUUID()].map((rewardId) =>
      expect(
        as(operatorClient, () =>
          service.redeemReward({ operationId: randomUUID(), customerId, rewardId }),
        ),
      ).rejects.toMatchObject({ kind: 'reward-unavailable' }),
    );
    await Promise.all(refusals);
  });

  it('EC006 customer-unavailable: an unknown customer, an anonymized one, an unknown movement', async () => {
    const anonymized = await newCustomer('ec006');
    await as(adminClient, () => customers.anonymize(anonymized));
    toErase.splice(toErase.indexOf(anonymized), 1);
    const refusals = [randomUUID(), anonymized].map((customerId) =>
      expect(
        as(operatorClient, () =>
          service.recordPurchase({ operationId: randomUUID(), customerId, amountCents: 500 }),
        ),
      ).rejects.toMatchObject({ kind: 'customer-unavailable' }),
    );
    await Promise.all(refusals);
    await expect(
      as(adminClient, () =>
        service.cancelMovement({ operationId: randomUUID(), movementId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ kind: 'customer-unavailable' });
  });

  it('EC007 conflict: the same operation_id with another amount', async () => {
    const customerId = await newCustomer('ec007');
    const operationId = randomUUID();
    await as(operatorClient, () =>
      service.recordPurchase({ operationId, customerId, amountCents: 500 }),
    );
    await expect(
      as(operatorClient, () =>
        service.recordPurchase({ operationId, customerId, amountCents: 600 }),
      ),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('22023 invalid: an amount of 0 and a free reward of 0 points', async () => {
    const customerId = await newCustomer('22023');
    await expect(
      as(operatorClient, () =>
        service.recordPurchase({ operationId: randomUUID(), customerId, amountCents: 0 }),
      ),
    ).rejects.toMatchObject({ kind: 'invalid' });
    await expect(
      as(operatorClient, () =>
        service.redeemFreeReward({
          operationId: randomUUID(),
          customerId,
          description: 'Zero punti',
          points: 0,
        }),
      ),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  describe('42501', () => {
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

    it('forbidden: a signed-in user without an operator profile', async () => {
      const customerId = await newCustomer('42501');
      const client = memoryClient(local.url, local.publishableKey);
      const { error } = await client.auth.signInWithPassword({ email, password });
      expect(error).toBeNull();
      await expect(
        as(client, () =>
          service.recordPurchase({ operationId: randomUUID(), customerId, amountCents: 500 }),
        ),
      ).rejects.toMatchObject({ name: 'LedgerError', kind: 'forbidden' });
    });

    it('a missing grant (anon has no execute) is a server fault, not a refusal', async () => {
      const anon = memoryClient(local.url, local.publishableKey);
      const failure: unknown = await as(anon, () =>
        service.recordPurchase({
          operationId: randomUUID(),
          customerId: randomUUID(),
          amountCents: 500,
        }),
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ServerFaultError);
      expect(failure).toMatchObject({ kind: 'misconfigured' });
    });
  });
});
