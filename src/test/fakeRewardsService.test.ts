import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../lib/serverFault';
import { createFakeRewardsService, fakeReward } from './fakeRewardsService';

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';

function newReward(
  overrides: Partial<{ id: string; name: string; points: number; active: boolean }> = {},
) {
  return { id: ID_1, name: 'Caffè', points: 50, active: true, ...overrides };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

describe('createFakeRewardsService', () => {
  it('creates a reward with the id it receives and a trimmed name', async () => {
    const { service, rewards } = createFakeRewardsService();
    const result = await service.create(newReward({ name: '  Spremuta  ', points: 80 }));

    expect(result).toEqual({
      ok: true,
      reward: { id: ID_1, name: 'Spremuta', points: 80, active: true },
    });
    expect(rewards()).toEqual([{ id: ID_1, name: 'Spremuta', points: 80, active: true }]);
  });

  it('makes one row from the same id sent twice, answering the saved reward both times', async () => {
    const { service, rewards, calls } = createFakeRewardsService();
    const first = await service.create(newReward());
    const second = await service.create(newReward({ name: 'Altro nome', points: 99 }));

    expect(second).toEqual(first);
    expect(rewards()).toHaveLength(1);
    expect(calls).toMatchObject([
      { method: 'create', args: [{ id: ID_1 }] },
      { method: 'create', args: [{ id: ID_1 }] },
    ]);
  });

  it('refuses an equivalent name (case, outer spaces) with name-taken, on create and update', async () => {
    const existing = fakeReward({ id: ID_1, name: 'Caffè' });
    const other = fakeReward({ id: ID_2, name: 'Cornetto' });
    const { service, rewards } = createFakeRewardsService({ rewards: [existing, other] });

    await expect(service.create(newReward({ id: ID_3, name: '  CAFFÈ ' }))).resolves.toEqual({
      ok: false,
      error: 'name-taken',
    });
    await expect(service.update(ID_2, { name: 'caffè', points: 10 })).resolves.toEqual({
      ok: false,
      error: 'name-taken',
    });
    // Its own name, in another case, is not taken.
    await expect(service.update(ID_1, { name: 'CAFFÈ', points: 60 })).resolves.toEqual({
      ok: true,
      reward: { ...existing, name: 'CAFFÈ', points: 60 },
    });
    expect(rewards()).toHaveLength(2);
  });

  it('refuses values outside the limits with invalid', async () => {
    const { service, rewards } = createFakeRewardsService();
    const results = await Promise.all(
      [
        newReward({ name: '   ' }),
        newReward({ name: 'x'.repeat(61) }),
        newReward({ points: 0 }),
        newReward({ points: 100_000 }),
        newReward({ points: 1.5 }),
      ].map((input) => service.create(input)),
    );
    expect(results.map((result) => result.ok || result.error)).toEqual(Array(5).fill('invalid'));
    await expect(
      service.create(newReward({ name: 'é'.repeat(60), points: 99_999 })),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(rewards()).toHaveLength(1);
  });

  it('answers not-found to update and setActive of an unknown reward', async () => {
    const { service } = createFakeRewardsService();
    await expect(service.update(ID_1, { name: 'Caffè', points: 10 })).resolves.toEqual({
      ok: false,
      error: 'not-found',
    });
    await expect(service.setActive(ID_1, false)).resolves.toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('refuses every write of an operator with forbidden, and still lets it read', async () => {
    const existing = fakeReward({ id: ID_1 });
    const { service, rewards } = createFakeRewardsService({
      rewards: [existing],
      role: 'operator',
    });

    await expect(service.create(newReward({ id: ID_2, name: 'Nuovo' }))).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    // Before idempotency, like the server: a resent id is refused too.
    await expect(service.create(newReward({ id: ID_1 }))).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    await expect(service.update(ID_1, { name: 'Altro', points: 5 })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    await expect(service.setActive(ID_1, false)).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(rewards()).toEqual([existing]);
    await expect(service.listAll()).resolves.toEqual([existing]);
  });

  it('sets a reward inactive and lists the catalog in sortRewards order, the active ones apart', async () => {
    const { service } = createFakeRewardsService({
      rewards: [
        fakeReward({ id: ID_1, name: 'Cornetto', points: 80 }),
        fakeReward({ id: ID_2, name: 'Caffè', points: 50 }),
        fakeReward({ id: ID_3, name: 'Aperitivo', points: 80 }),
      ],
    });
    await expect(service.setActive(ID_2, false)).resolves.toEqual({
      ok: true,
      reward: { id: ID_2, name: 'Caffè', points: 50, active: false },
    });

    expect((await service.listAll()).map((reward) => reward.name)).toEqual([
      'Aperitivo',
      'Cornetto',
      'Caffè',
    ]);
    expect((await service.listActive()).map((reward) => reward.name)).toEqual([
      'Aperitivo',
      'Cornetto',
    ]);
  });

  it('applies a write whose answer is lost and resolves it with network', async () => {
    const { service, rewards, failNext } = createFakeRewardsService();
    failNext('create', 'lost');

    await expect(service.create(newReward())).resolves.toEqual({ ok: false, error: 'network' });
    expect(rewards()).toHaveLength(1);
    // The resend with the same id finds the saved row.
    await expect(service.create(newReward())).resolves.toMatchObject({ ok: true });
    expect(rewards()).toHaveLength(1);
  });

  it('answers a programmed refusal without changing anything, one per call', async () => {
    const { service, rewards, failNext } = createFakeRewardsService();
    failNext('create', 'unknown');

    await expect(service.create(newReward())).resolves.toEqual({ ok: false, error: 'unknown' });
    expect(rewards()).toEqual([]);
    await expect(service.create(newReward())).resolves.toMatchObject({ ok: true });
  });

  it('rejects with a programmed ServerFaultError, on writes and reads', async () => {
    const { service, rewards, failNext } = createFakeRewardsService();
    failNext('create', new ServerFaultError('unavailable'));
    failNext('listAll', new ServerFaultError('unavailable'));

    expect(await rejection(service.create(newReward()))).toBeInstanceOf(ServerFaultError);
    expect(await rejection(service.listAll())).toBeInstanceOf(ServerFaultError);
    expect(rewards()).toEqual([]);
  });

  it('rejects a read programmed to fail with a plain Error', async () => {
    const { service, failNext } = createFakeRewardsService();
    failNext('listActive', 'network');

    const error = await rejection(service.listActive());
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ServerFaultError);
    await expect(service.listActive()).resolves.toEqual([]);
  });

  it('while the network is down, fails every call and changes nothing', async () => {
    const { service, rewards, setNetworkDown } = createFakeRewardsService();
    setNetworkDown(true);

    await expect(service.create(newReward())).resolves.toEqual({ ok: false, error: 'network' });
    expect(await rejection(service.listAll())).toBeInstanceOf(Error);
    expect(rewards()).toEqual([]);

    setNetworkDown(false);
    await expect(service.create(newReward())).resolves.toMatchObject({ ok: true });
  });

  it('holds an answer until released, so answers can arrive out of order', async () => {
    const { service, holdNext } = createFakeRewardsService({
      rewards: [fakeReward({ id: ID_1, active: true })],
    });
    const held = holdNext('setActive');
    const order: string[] = [];

    const first = service.setActive(ID_1, false).then(() => order.push('first'));
    const second = service.listAll().then(() => order.push('second'));
    await second;
    expect(order).toEqual(['second']);

    held.release();
    await first;
    expect(order).toEqual(['second', 'first']);
  });

  it('logs every call with its arguments and exposes each method as a mock', async () => {
    const { service, calls } = createFakeRewardsService({ rewards: [fakeReward({ id: ID_1 })] });
    await service.listAll();
    await service.setActive(ID_1, false);

    expect(calls).toEqual([
      { method: 'listAll', args: [] },
      { method: 'setActive', args: [ID_1, false] },
    ]);
    expect(service.setActive).toHaveBeenCalledTimes(1);
  });

  it('returns copies, so callers cannot change the stored rewards', async () => {
    const { service, rewards } = createFakeRewardsService({
      rewards: [fakeReward({ id: ID_1, name: 'Caffè' })],
    });
    const [listed] = await service.listAll();
    if (listed) listed.name = 'Cambiato';
    expect(rewards()[0]?.name).toBe('Caffè');
  });
});
