import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../lib/serverFault';
import { KioskError } from '../features/tablet-kiosk/types';
import type { KioskErrorKind, UnlockResult } from '../features/tablet-kiosk/types';
import {
  KIOSK_LOCK_MS,
  KIOSK_TURN_MS,
  createFakeKioskService,
  fakeCashier,
} from './fakeKioskService';

async function kioskErrorOf(promise: Promise<unknown>): Promise<KioskErrorKind> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (rejected: unknown) => rejected,
  );
  if (!(error instanceof KioskError)) throw error;
  return error.kind;
}

const ANNA = fakeCashier({ name: 'Anna Prova', role: 'admin', pin: '1234' });
const BRUNO = fakeCashier({ name: 'Bruno Prova', pin: '5678' });
const CARLA = fakeCashier({ name: 'Carla Prova', pin: null });

/** A device with three cashiers and a clock the test moves by hand. */
function setUp(options: Parameters<typeof createFakeKioskService>[0] = {}) {
  let now = Date.parse('2026-11-18T18:00:00.000Z');
  const kiosk = createFakeKioskService({
    cashiers: [ANNA, BRUNO, CARLA],
    now: () => now,
    ...options,
  });
  return {
    kiosk,
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

type FakeKiosk = ReturnType<typeof createFakeKioskService>;

/** Sends the same unlock `times` times, one after the other, and returns every answer. */
async function unlockInTurn(kiosk: FakeKiosk, operatorId: string, pin: string, times: number) {
  const results: UnlockResult[] = [];
  for (let attempt = 0; attempt < times; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each attempt must see the counter the one before left.
    results.push(await kiosk.service.unlock(operatorId, pin));
  }
  return results;
}

describe('fakeCashier', () => {
  it('builds cashiers with fake names, fresh UUID-shaped ids and a PIN by default', () => {
    const a = fakeCashier();
    const b = fakeCashier();
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).toMatchObject({ role: 'operator', pin: '0000' });
    expect(a.name).toMatch(/Prova/);
  });
});

describe('listCashiers', () => {
  it('returns every cashier with hasPin and never the PIN', async () => {
    const { kiosk } = setUp();
    const cashiers = await kiosk.service.listCashiers();
    expect(cashiers).toEqual([
      { id: ANNA.id, name: 'Anna Prova', role: 'admin', hasPin: true },
      { id: BRUNO.id, name: 'Bruno Prova', role: 'operator', hasPin: true },
      { id: CARLA.id, name: 'Carla Prova', role: 'operator', hasPin: false },
    ]);
    expect(JSON.stringify(cashiers)).not.toContain('1234');
  });

  it('works without a cashier and rejects with forbidden on an operator account', async () => {
    const { kiosk } = setUp({ account: { kind: 'operator', operatorId: ANNA.id } });
    expect(await kioskErrorOf(kiosk.service.listCashiers())).toBe('forbidden');
  });

  it('has default cashiers when none are passed', async () => {
    const kiosk = createFakeKioskService();
    const cashiers = await kiosk.service.listCashiers();
    expect(cashiers.some((cashier) => cashier.hasPin)).toBe(true);
    expect(cashiers.some((cashier) => !cashier.hasPin)).toBe(true);
    expect(cashiers.some((cashier) => cashier.role === 'admin')).toBe(true);
  });
});

describe('unlock', () => {
  it('makes the person the cashier for 12 hours with the right PIN', async () => {
    const { kiosk, at } = setUp();
    const result = await kiosk.service.unlock(BRUNO.id, '5678');
    const turnExpiresAt = new Date(at() + KIOSK_TURN_MS);
    expect(KIOSK_TURN_MS).toBe(12 * 60 * 60 * 1000);
    expect(result).toEqual({
      status: 'ok',
      cashier: { id: BRUNO.id, name: 'Bruno Prova', role: 'operator' },
      turnExpiresAt,
    });
    expect(kiosk.device()).toMatchObject({
      cashier: { id: BRUNO.id, name: 'Bruno Prova', role: 'operator' },
      turnExpiresAt,
      failedAttempts: 0,
      lockSecondsLeft: null,
    });
  });

  it('counts wrong PINs per device, on any operator', async () => {
    const { kiosk } = setUp();
    expect(await kiosk.service.unlock(ANNA.id, '0000')).toEqual({
      status: 'wrong-pin',
      attemptsLeft: 4,
    });
    expect(await kiosk.service.unlock(BRUNO.id, '0000')).toEqual({
      status: 'wrong-pin',
      attemptsLeft: 3,
    });
    expect(kiosk.device().failedAttempts).toBe(2);
  });

  it('locks the device for 5 minutes at the 5th wrong PIN', async () => {
    const { kiosk } = setUp();
    expect(await unlockInTurn(kiosk, ANNA.id, '9999', 4)).toEqual(
      [4, 3, 2, 1].map((attemptsLeft) => ({ status: 'wrong-pin', attemptsLeft })),
    );
    expect(KIOSK_LOCK_MS).toBe(5 * 60 * 1000);
    expect(await kiosk.service.unlock(ANNA.id, '9999')).toEqual({
      status: 'locked',
      lockSecondsLeft: 300,
    });
    expect(kiosk.device()).toMatchObject({ failedAttempts: 0, lockSecondsLeft: 300 });
  });

  it('answers locked even to the right PIN during the lock, without counting it', async () => {
    const { kiosk, advance } = setUp({ lockedForMs: KIOSK_LOCK_MS });
    advance(60_500);
    expect(await kiosk.service.unlock(ANNA.id, '1234')).toEqual({
      status: 'locked',
      lockSecondsLeft: 240,
    });
    expect(await kiosk.service.unlock(ANNA.id, '9999')).toEqual({
      status: 'locked',
      lockSecondsLeft: 240,
    });
    expect(kiosk.device()).toMatchObject({ cashier: null, failedAttempts: 0 });
    advance(240_000);
    expect(await kiosk.service.unlock(ANNA.id, '1234')).toMatchObject({ status: 'ok' });
  });

  it('resets the counter on a success', async () => {
    const { kiosk } = setUp();
    await unlockInTurn(kiosk, ANNA.id, '9999', 4);
    expect(await kiosk.service.unlock(ANNA.id, '1234')).toMatchObject({ status: 'ok' });
    expect(kiosk.device().failedAttempts).toBe(0);
    expect(await kiosk.service.unlock(BRUNO.id, '9999')).toEqual({
      status: 'wrong-pin',
      attemptsLeft: 4,
    });
  });

  it('answers no-pin for an operator without a PIN or unknown, without counting it', async () => {
    const { kiosk } = setUp();
    expect(await kiosk.service.unlock(CARLA.id, '1234')).toEqual({ status: 'no-pin' });
    expect(await kiosk.service.unlock('00000000-0000-4000-e000-999999999999', '1234')).toEqual({
      status: 'no-pin',
    });
    expect(kiosk.device().failedAttempts).toBe(0);
  });

  it('rejects with invalid a PIN that is not 4 digits, without counting it', async () => {
    const { kiosk } = setUp();
    expect(await kioskErrorOf(kiosk.service.unlock(ANNA.id, '12'))).toBe('invalid');
    expect(await kioskErrorOf(kiosk.service.unlock(ANNA.id, '12a4'))).toBe('invalid');
    expect(kiosk.device().failedAttempts).toBe(0);
  });

  it('replaces the cashier on a new unlock', async () => {
    const { kiosk } = setUp();
    await kiosk.service.unlock(ANNA.id, '1234');
    await kiosk.service.unlock(BRUNO.id, '5678');
    expect(kiosk.device().cashier?.id).toBe(BRUNO.id);
  });

  it('rejects with forbidden on an operator account', async () => {
    const { kiosk } = setUp({ account: { kind: 'operator', operatorId: ANNA.id } });
    expect(await kioskErrorOf(kiosk.service.unlock(ANNA.id, '1234'))).toBe('forbidden');
  });
});

describe('the turn', () => {
  it('ends after 12 hours', async () => {
    const { kiosk, advance } = setUp();
    await kiosk.service.unlock(ANNA.id, '1234');
    advance(KIOSK_TURN_MS - 1);
    expect(kiosk.device().cashier?.id).toBe(ANNA.id);
    advance(1);
    expect(kiosk.device()).toMatchObject({ cashier: null, turnExpiresAt: null });
  });

  it('ends with endTurn, idempotently, keeping the counter and the lock', async () => {
    const { kiosk } = setUp();
    await kiosk.service.unlock(ANNA.id, '1234');
    await kiosk.service.unlock(ANNA.id, '9999');
    await expect(kiosk.service.endTurn()).resolves.toBeUndefined();
    await expect(kiosk.service.endTurn()).resolves.toBeUndefined();
    expect(kiosk.device()).toMatchObject({ cashier: null, failedAttempts: 1 });
  });

  it('starts with a cashier when the test says so', () => {
    const { kiosk, at } = setUp({ cashierId: BRUNO.id });
    expect(kiosk.device()).toMatchObject({
      cashier: { id: BRUNO.id },
      turnExpiresAt: new Date(at() + KIOSK_TURN_MS),
    });
  });

  it('can be expired by the test', () => {
    const { kiosk } = setUp({ cashierId: BRUNO.id });
    kiosk.expireTurn();
    expect(kiosk.device().cashier).toBeNull();
  });
});

describe('setMyPin', () => {
  it("sets the caller's PIN and closes their turn on the device", async () => {
    const { kiosk } = setUp({ account: { kind: 'operator', operatorId: CARLA.id } });
    expect(await kiosk.service.setMyPin('4321')).toEqual({ status: 'ok' });
    expect(kiosk.hasPin(CARLA.id)).toBe(true);
  });

  it("closes the person's open turn when they change their PIN", async () => {
    const { kiosk } = setUp({ cashierId: BRUNO.id });
    kiosk.setPin(BRUNO.id, '1111');
    expect(kiosk.device().cashier).toBeNull();
    expect(await kiosk.service.unlock(BRUNO.id, '5678')).toMatchObject({ status: 'wrong-pin' });
    expect(await kiosk.service.unlock(BRUNO.id, '1111')).toMatchObject({ status: 'ok' });
  });

  it('rejects with forbidden on a device and invalid on a malformed PIN', async () => {
    expect(await kioskErrorOf(setUp().kiosk.service.setMyPin('1234'))).toBe('forbidden');
    const { kiosk } = setUp({ account: { kind: 'operator', operatorId: CARLA.id } });
    expect(await kioskErrorOf(kiosk.service.setMyPin('123'))).toBe('invalid');
    expect(kiosk.hasPin(CARLA.id)).toBe(false);
  });
});

describe('network, failures and holds', () => {
  it('with the network down: unlock and setMyPin resolve network, the others reject, nothing changes', async () => {
    const { kiosk } = setUp();
    kiosk.setNetworkDown(true);
    expect(await kiosk.service.unlock(ANNA.id, '9999')).toEqual({ status: 'network' });
    expect(kiosk.device().failedAttempts).toBe(0);
    expect(await kioskErrorOf(kiosk.service.listCashiers())).toBe('network');
    expect(await kioskErrorOf(kiosk.service.endTurn())).toBe('network');
    const operator = setUp({ account: { kind: 'operator', operatorId: CARLA.id } }).kiosk;
    operator.setNetworkDown(true);
    expect(await operator.service.setMyPin('4321')).toEqual({ status: 'network' });
    expect(operator.hasPin(CARLA.id)).toBe(false);
  });

  it('failNext programs one failure: a kind, an error or a lost answer', async () => {
    const { kiosk } = setUp({ cashierId: ANNA.id });
    kiosk.failNext('endTurn', 'unknown');
    expect(await kioskErrorOf(kiosk.service.endTurn())).toBe('unknown');
    expect(kiosk.device().cashier?.id).toBe(ANNA.id);
    kiosk.failNext('listCashiers', new ServerFaultError('unavailable'));
    await expect(kiosk.service.listCashiers()).rejects.toBeInstanceOf(ServerFaultError);
    kiosk.failNext('endTurn', 'lost');
    expect(await kioskErrorOf(kiosk.service.endTurn())).toBe('network');
    expect(kiosk.device().cashier).toBeNull();
    kiosk.failNext('unlock', 'network');
    expect(await kiosk.service.unlock(ANNA.id, '1234')).toEqual({ status: 'network' });
    expect(await kiosk.service.unlock(ANNA.id, '1234')).toMatchObject({ status: 'ok' });
  });

  it('holdNext delays the answer until released', async () => {
    const { kiosk } = setUp();
    const hold = kiosk.holdNext('unlock');
    let answered = false;
    const pending = kiosk.service.unlock(ANNA.id, '1234').then((result) => {
      answered = true;
      return result;
    });
    await Promise.resolve();
    expect(answered).toBe(false);
    hold.release();
    expect(await pending).toMatchObject({ status: 'ok' });
  });

  it('logs every call without the PIN in clear', async () => {
    const { kiosk } = setUp({ account: { kind: 'device' } });
    await kiosk.service.listCashiers();
    await kiosk.service.unlock(ANNA.id, '1234');
    await kiosk.service.endTurn();
    await kioskErrorOf(kiosk.service.setMyPin('8765'));
    expect(kiosk.calls).toEqual([
      { method: 'listCashiers' },
      { method: 'unlock', operatorId: ANNA.id },
      { method: 'endTurn' },
      { method: 'setMyPin' },
    ]);
    expect(kiosk.service.unlock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(kiosk.calls)).not.toMatch(/1234|8765/);
  });
});
