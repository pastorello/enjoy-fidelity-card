import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../lib/serverFault';
import { REQUEST_TIMEOUT_MS } from '../features/ledger/supabaseLedgerService';
import { LedgerError } from '../features/ledger/types';
import type { LedgerErrorKind } from '../features/ledger/types';
import { createFakeCustomerService, fakeCustomer } from './fakeCustomerService';
import { createFakeLedgerService, fakeMovement } from './fakeLedgerService';
import { createFakeRewardsService, fakeReward } from './fakeRewardsService';
import { createFakeSettingsService, defaultSettings } from './fakeSettingsService';

const OP_1 = '11111111-1111-4111-8111-111111111111';
const OP_2 = '22222222-2222-4222-8222-222222222222';
const OP_3 = '33333333-3333-4333-8333-333333333333';
const OP_4 = '44444444-4444-4444-8444-444444444444';
const WAITER = { id: 'op-2', name: 'Andrea Prova', role: 'operator' as const };

async function errorKind(promise: Promise<unknown>): Promise<LedgerErrorKind> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (rejected: unknown) => rejected,
  );
  if (!(error instanceof LedgerError)) throw error;
  return error.kind;
}

function setup(options: { balance?: number; centsPerPoint?: number } = {}) {
  const maria = fakeCustomer({ name: 'Maria Rossi', balance: options.balance ?? 0 });
  const gone = fakeCustomer({
    name: 'Cliente cancellato 00000000',
    anonymizedAt: '2026-11-01T10:00:00Z',
  });
  const customers = createFakeCustomerService({ customers: [maria, gone] });
  const coffee = fakeReward({ name: 'Caffè', points: 50 });
  const old = fakeReward({ name: 'Cornetto', points: 30, active: false });
  const rewards = createFakeRewardsService({ rewards: [coffee, old] });
  const settings = createFakeSettingsService({
    settings: { ...defaultSettings, centsPerPoint: options.centsPerPoint ?? 100 },
  });
  const ledger = createFakeLedgerService({ customers, rewards, settings });
  const balanceOf = (id: string) => customers.customers().find((c) => c.id === id)?.balance;
  return { maria, gone, coffee, old, customers, rewards, settings, ledger, balanceOf };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createFakeLedgerService: purchases', () => {
  it('rounds down with the ratio in force and saves it on the movement', async () => {
    const { maria, ledger, settings, balanceOf } = setup({ balance: 120 });
    const first = await ledger.service.recordPurchase({
      operationId: OP_1,
      customerId: maria.id,
      amountCents: 1250,
    });
    expect(first.movement).toMatchObject({
      kind: 'purchase',
      amountCents: 1250,
      points: 12,
      centsPerPoint: 100,
      operationId: OP_1,
      customerId: maria.id,
      operatorId: 'op-1',
      operatorName: 'Giulia Prova',
      cancelledById: null,
    });
    expect(first.balance).toBe(132);
    settings.changeElsewhere({ centsPerPoint: 300 });
    const second = await ledger.service.recordPurchase({
      operationId: OP_2,
      customerId: maria.id,
      amountCents: 1250,
    });
    expect(second.movement).toMatchObject({ points: 4, centsPerPoint: 300 });
    expect(second.balance).toBe(136);
    expect(balanceOf(maria.id)).toBe(136);
  });

  it('updates the customers fake: balance, last served and the top of the list', async () => {
    const { maria, customers, ledger } = setup();
    const { movement } = await ledger.service.recordPurchase({
      operationId: OP_1,
      customerId: maria.id,
      amountCents: 500,
    });
    const { customers: listed } = await customers.service.list({ query: '', after: null });
    expect(listed[0]).toMatchObject({
      id: maria.id,
      balance: 5,
      lastActivityAt: movement.createdAt,
    });
    await expect(customers.service.get(maria.id)).resolves.toMatchObject({
      balance: 5,
      lastServedAt: movement.createdAt,
    });
  });

  it('a purchase brings the customer to the top of the list; its cancellation does not move it', async () => {
    const { maria, customers, ledger } = setup();
    const luca = await customers.service.create({
      operationId: OP_4,
      name: 'Luca Bianchi',
      phone: '',
      email: '',
      privacyConsent: true,
      notes: '',
    });
    const before = await customers.service.list({ query: '', after: null });
    expect(before.customers.map((c) => c.id)).toEqual([luca.id, maria.id]);

    const { movement } = await ledger.service.recordPurchase({
      operationId: OP_1,
      customerId: maria.id,
      amountCents: 500,
    });
    const after = await customers.service.list({ query: '', after: null });
    expect(after.customers.map((c) => c.id)).toEqual([maria.id, luca.id]);
    expect(after.customers[0]).toMatchObject({ balance: 5, lastActivityAt: movement.createdAt });

    ledger.advanceClock(1000);
    await ledger.service.cancelMovement({ operationId: OP_2, movementId: movement.id });
    const cancelled = await customers.service.list({ query: '', after: null });
    expect(cancelled.customers[0]).toMatchObject({
      id: maria.id,
      balance: 0,
      lastActivityAt: movement.createdAt,
    });
  });

  it('refuses amounts outside 1..9.999.999 integer cents with invalid', async () => {
    const { maria, ledger } = setup();
    const kinds = await Promise.all(
      [0, -1, 10_000_000, 12.5].map((amountCents) =>
        errorKind(
          ledger.service.recordPurchase({ operationId: OP_1, customerId: maria.id, amountCents }),
        ),
      ),
    );
    expect(kinds).toEqual(['invalid', 'invalid', 'invalid', 'invalid']);
    await expect(
      ledger.service.recordPurchase({
        operationId: OP_1,
        customerId: maria.id,
        amountCents: 9_999_999,
      }),
    ).resolves.toMatchObject({ balance: 99_999 });
  });

  it('a missing or anonymized customer is customer-unavailable; no operator is forbidden', async () => {
    const { gone, ledger } = setup();
    expect(
      await errorKind(
        ledger.service.recordPurchase({ operationId: OP_1, customerId: 'nope', amountCents: 100 }),
      ),
    ).toBe('customer-unavailable');
    expect(
      await errorKind(
        ledger.service.recordPurchase({ operationId: OP_1, customerId: gone.id, amountCents: 100 }),
      ),
    ).toBe('customer-unavailable');
    ledger.setOperator(null);
    expect(
      await errorKind(
        ledger.service.recordPurchase({ operationId: OP_1, customerId: gone.id, amountCents: 100 }),
      ),
    ).toBe('forbidden');
    expect(ledger.movements()).toEqual([]);
  });
});

describe('createFakeLedgerService: idempotency (criterion 4)', () => {
  it('a resend with the same id returns the first movement with the current balance', async () => {
    const { maria, ledger } = setup();
    const input = { operationId: OP_1, customerId: maria.id, amountCents: 1250 };
    const first = await ledger.service.recordPurchase(input);
    await ledger.service.recordPurchase({
      operationId: OP_2,
      customerId: maria.id,
      amountCents: 100,
    });
    const again = await ledger.service.recordPurchase(input);
    expect(again.movement).toEqual(first.movement);
    expect(again.balance).toBe(13);
    expect(ledger.movements()).toHaveLength(2);
  });

  it('the same id with other parameters or another kind is conflict', async () => {
    const { maria, coffee, ledger } = setup({ balance: 100 });
    await ledger.service.recordPurchase({
      operationId: OP_1,
      customerId: maria.id,
      amountCents: 100,
    });
    expect(
      await errorKind(
        ledger.service.recordPurchase({
          operationId: OP_1,
          customerId: maria.id,
          amountCents: 200,
        }),
      ),
    ).toBe('conflict');
    expect(
      await errorKind(
        ledger.service.redeemReward({
          operationId: OP_1,
          customerId: maria.id,
          rewardId: coffee.id,
        }),
      ),
    ).toBe('conflict');
    expect(ledger.movements()).toHaveLength(1);
  });

  it('an answer lost after the write, then a resend: one movement, the first result', async () => {
    const { maria, ledger, balanceOf } = setup();
    const input = { operationId: OP_1, customerId: maria.id, amountCents: 1250 };
    ledger.failNext('recordPurchase', 'lost');
    expect(await errorKind(ledger.service.recordPurchase(input))).toBe('network');
    expect(ledger.movements()).toHaveLength(1);
    const resent = await ledger.service.recordPurchase(input);
    expect(resent.movement.id).toBe(ledger.movements()[0]?.id);
    expect(resent.balance).toBe(12);
    expect(balanceOf(maria.id)).toBe(12);
    expect(ledger.movements()).toHaveLength(1);
  });

  it('a replay of a redemption answers even after the reward was deactivated', async () => {
    const { maria, coffee, rewards, ledger } = setup({ balance: 100 });
    const input = { operationId: OP_1, customerId: maria.id, rewardId: coffee.id };
    const first = await ledger.service.redeemReward(input);
    await rewards.service.setActive(coffee.id, false);
    await expect(ledger.service.redeemReward(input)).resolves.toEqual(first);
  });
});

describe('createFakeLedgerService: redemptions', () => {
  it('a catalog reward uses its current points and name; insufficient balance is refused', async () => {
    const { maria, coffee, rewards, ledger, balanceOf } = setup({ balance: 59 });
    const result = await ledger.service.redeemReward({
      operationId: OP_1,
      customerId: maria.id,
      rewardId: coffee.id,
    });
    expect(result.movement).toMatchObject({
      kind: 'redemption',
      points: -50,
      rewardId: coffee.id,
      description: 'Caffè',
      amountCents: null,
      centsPerPoint: null,
    });
    expect(result.balance).toBe(9);
    await rewards.service.update(coffee.id, { name: 'Caffè', points: 5 });
    await expect(
      ledger.service.redeemReward({ operationId: OP_2, customerId: maria.id, rewardId: coffee.id }),
    ).resolves.toMatchObject({ balance: 4, movement: { points: -5 } });
    expect(
      await errorKind(
        ledger.service.redeemReward({
          operationId: OP_3,
          customerId: maria.id,
          rewardId: coffee.id,
        }),
      ),
    ).toBe('insufficient-balance');
    expect(balanceOf(maria.id)).toBe(4);
  });

  it('a missing or inactive reward is reward-unavailable', async () => {
    const { maria, old, ledger } = setup({ balance: 100 });
    const kinds = await Promise.all(
      [old.id, 'missing'].map((rewardId) =>
        errorKind(
          ledger.service.redeemReward({ operationId: OP_1, customerId: maria.id, rewardId }),
        ),
      ),
    );
    expect(kinds).toEqual(['reward-unavailable', 'reward-unavailable']);
  });

  it('a free reward: description trimmed 1..80, points 1..99.999, never below zero', async () => {
    const { maria, ledger } = setup({ balance: 120 });
    const free = (operationId: string, description: string, points: number) =>
      ledger.service.redeemFreeReward({ operationId, customerId: maria.id, description, points });
    const invalid = [
      ['   ', 10],
      ['x'.repeat(81), 10],
      ['Dolce', 0],
      ['Dolce', 100_000],
      ['Dolce', 1.5],
    ] as const;
    const kinds = await Promise.all(
      invalid.map(([description, points]) => errorKind(free(OP_1, description, points))),
    );
    expect(kinds).toEqual(invalid.map(() => 'invalid'));
    expect(await errorKind(free(OP_1, 'Dolce', 121))).toBe('insufficient-balance');
    await expect(free(OP_1, '  Dolce del giorno ', 120)).resolves.toMatchObject({
      balance: 0,
      movement: {
        kind: 'redemption',
        points: -120,
        rewardId: null,
        description: 'Dolce del giorno',
      },
    });
    await expect(free(OP_1, 'Dolce del giorno', 120)).resolves.toMatchObject({ balance: 0 });
    expect(await errorKind(free(OP_1, 'Dolce', 120))).toBe('conflict');
  });
});

describe('createFakeLedgerService: cancellations', () => {
  it('an operator cancels their own movement within 10 s, not after (EC003)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T09:42:00.000Z'));
    const { maria, ledger } = setup();
    ledger.setOperator(WAITER);
    const a = await ledger.service.recordPurchase({
      operationId: OP_1,
      customerId: maria.id,
      amountCents: 1000,
    });
    const b = await ledger.service.recordPurchase({
      operationId: OP_2,
      customerId: maria.id,
      amountCents: 500,
    });
    ledger.advanceClock(10_000);
    const cancelled = await ledger.service.cancelMovement({
      operationId: OP_3,
      movementId: b.movement.id,
    });
    expect(cancelled.movement).toMatchObject({
      kind: 'correction',
      points: -5,
      correctsMovementId: b.movement.id,
      correctedKind: 'purchase',
      correctedCreatedAt: b.movement.createdAt,
      operatorName: 'Andrea Prova',
    });
    expect(cancelled.balance).toBe(10);
    ledger.advanceClock(1);
    expect(
      await errorKind(
        ledger.service.cancelMovement({ operationId: OP_4, movementId: a.movement.id }),
      ),
    ).toBe('cancel-window-expired');
    // A replay answers the first correction even after the window.
    await expect(
      ledger.service.cancelMovement({ operationId: OP_3, movementId: b.movement.id }),
    ).resolves.toMatchObject({ movement: { id: cancelled.movement.id } });
  });

  it("an operator cannot cancel someone else's movement; an admin cancels any, any time", async () => {
    const { maria, ledger } = setup();
    const own = await ledger.service.recordPurchase({
      operationId: OP_1,
      customerId: maria.id,
      amountCents: 1000,
    });
    ledger.setOperator(WAITER);
    expect(
      await errorKind(
        ledger.service.cancelMovement({ operationId: OP_2, movementId: own.movement.id }),
      ),
    ).toBe('cancel-window-expired');
    ledger.setOperator({ id: 'op-1', name: 'Giulia Prova', role: 'admin' });
    ledger.advanceClock(3_600_000);
    await expect(
      ledger.service.cancelMovement({ operationId: OP_2, movementId: own.movement.id }),
    ).resolves.toMatchObject({ balance: 0 });
  });

  it('corrections are not-cancellable, a second cancel is already-cancelled, history shows it', async () => {
    const { maria, ledger } = setup();
    const bought = await ledger.service.recordPurchase({
      operationId: OP_1,
      customerId: maria.id,
      amountCents: 1000,
    });
    const fix = await ledger.service.cancelMovement({
      operationId: OP_2,
      movementId: bought.movement.id,
    });
    expect(
      await errorKind(
        ledger.service.cancelMovement({ operationId: OP_3, movementId: bought.movement.id }),
      ),
    ).toBe('already-cancelled');
    expect(
      await errorKind(
        ledger.service.cancelMovement({ operationId: OP_3, movementId: fix.movement.id }),
      ),
    ).toBe('not-cancellable');
    expect(
      await errorKind(ledger.service.cancelMovement({ operationId: OP_3, movementId: 'missing' })),
    ).toBe('customer-unavailable');
    const history = await ledger.service.listMovements(maria.id);
    expect(history.map((m) => m.id)).toEqual([fix.movement.id, bought.movement.id]);
    expect(history[1]).toMatchObject({
      cancelledById: fix.movement.id,
      cancelledAt: fix.movement.createdAt,
    });
  });

  it('a purchase whose points were spent cannot be cancelled; a redemption can', async () => {
    const { maria, ledger } = setup();
    const bought = await ledger.service.recordPurchase({
      operationId: OP_1,
      customerId: maria.id,
      amountCents: 1000,
    });
    const spent = await ledger.service.redeemFreeReward({
      operationId: OP_2,
      customerId: maria.id,
      description: 'Dolce',
      points: 6,
    });
    expect(
      await errorKind(
        ledger.service.cancelMovement({ operationId: OP_3, movementId: bought.movement.id }),
      ),
    ).toBe('insufficient-balance');
    await expect(
      ledger.service.cancelMovement({ operationId: OP_3, movementId: spent.movement.id }),
    ).resolves.toMatchObject({ balance: 10, movement: { points: 6, correctedKind: 'redemption' } });
  });

  it("an anonymized customer's movement can still be cancelled", async () => {
    const { maria, customers, ledger } = setup();
    const bought = await ledger.service.recordPurchase({
      operationId: OP_1,
      customerId: maria.id,
      amountCents: 1000,
    });
    await customers.service.anonymize(maria.id);
    await expect(
      ledger.service.cancelMovement({ operationId: OP_2, movementId: bought.movement.id }),
    ).resolves.toMatchObject({ balance: 0 });
  });
});

describe('createFakeLedgerService: listMovements', () => {
  it('newest first, limit and cursor, seeded history included', async () => {
    const { maria, customers, ledger } = setup();
    const older = fakeMovement({ customerId: maria.id, createdAt: '2026-11-08T17:05:00.000Z' });
    const fake = createFakeLedgerService({ customers, movements: [older] });
    expect(await fake.service.listMovements(maria.id)).toEqual([older]);
    // Sent together: the fake applies them in call order, as the customer lock would.
    const results = await Promise.all(
      [OP_1, OP_2, OP_3].map((operationId) =>
        ledger.service.recordPurchase({ operationId, customerId: maria.id, amountCents: 100 }),
      ),
    );
    const ids = results.map(({ movement }) => movement.id).toReversed();
    const page = await ledger.service.listMovements(maria.id, { limit: 2 });
    expect(page.map((m) => m.id)).toEqual(ids.slice(0, 2));
    const last = page[1];
    if (!last) throw new Error('missing row');
    const next = await ledger.service.listMovements(maria.id, {
      before: { createdAt: last.createdAt, id: last.id },
    });
    expect(next.map((m) => m.id)).toEqual(ids.slice(2));
    expect(await ledger.service.listMovements('other')).toEqual([]);
    expect(await errorKind(ledger.service.listMovements(maria.id, { limit: 51 }))).toBe('invalid');
  });
});

describe('createFakeLedgerService: faults and call log', () => {
  it('logs every call; programmed refusals and errors change nothing', async () => {
    const { maria, ledger } = setup();
    const input = { operationId: OP_1, customerId: maria.id, amountCents: 100 };
    ledger.failNext('recordPurchase', 'insufficient-balance');
    ledger.failNext('recordPurchase', new ServerFaultError('unavailable'));
    expect(await errorKind(ledger.service.recordPurchase(input))).toBe('insufficient-balance');
    await expect(ledger.service.recordPurchase(input)).rejects.toBeInstanceOf(ServerFaultError);
    expect(ledger.movements()).toEqual([]);
    expect(ledger.calls).toEqual([
      { method: 'recordPurchase', args: [input] },
      { method: 'recordPurchase', args: [input] },
    ]);
    expect(ledger.service.recordPurchase).toHaveBeenCalledTimes(2);
  });

  it('network down rejects with network and writes nothing', async () => {
    const { maria, ledger } = setup();
    ledger.setNetworkDown(true);
    expect(
      await errorKind(
        ledger.service.recordPurchase({
          operationId: OP_1,
          customerId: maria.id,
          amountCents: 100,
        }),
      ),
    ).toBe('network');
    expect(await errorKind(ledger.service.listMovements(maria.id))).toBe('network');
    ledger.setNetworkDown(false);
    expect(ledger.movements()).toEqual([]);
  });

  it('a timeout rejects with network after 8 s and writes nothing', async () => {
    vi.useFakeTimers();
    const { maria, ledger } = setup();
    ledger.failNext('recordPurchase', 'timeout');
    const outcome = errorKind(
      ledger.service.recordPurchase({ operationId: OP_1, customerId: maria.id, amountCents: 100 }),
    );
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe('network');
    expect(ledger.movements()).toEqual([]);
  });

  it('holdNext delays the answer, and the write, until released', async () => {
    const { maria, ledger } = setup();
    const hold = ledger.holdNext('recordPurchase');
    const pending = ledger.service.recordPurchase({
      operationId: OP_1,
      customerId: maria.id,
      amountCents: 100,
    });
    await Promise.resolve();
    expect(ledger.movements()).toEqual([]);
    hold.release();
    await expect(pending).resolves.toMatchObject({ balance: 1 });
  });
});
