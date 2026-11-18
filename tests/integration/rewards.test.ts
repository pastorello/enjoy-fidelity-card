import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { supabaseRewardsService as service } from '../../src/features/rewards/supabaseRewardsService';
import { localSupabase, memoryClient, runSql, runSqlInBackground } from './localSupabase';

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
// A name of this run's own, so the suite repeats without db:reset.
const SUFFIX = randomBytes(4).toString('hex');
const NAME = `Spremuta integrazione ${SUFFIX}`;
const ID = randomUUID();
// Rows the concurrency tests make, removed at the end like ID.
const RACE_IDS: string[] = [];

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = memoryClient(local.url, local.publishableKey);
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

let adminClient: SupabaseClient;
let operatorClient: SupabaseClient;

beforeAll(async () => {
  adminClient = await signedIn('admin@example.com');
  operatorClient = await signedIn('operatore@example.com');
});

afterAll(() => {
  // The app can never delete a reward; the database owner removes this run's row so the catalog
  // the e2e suite checks stays the seed's.
  runSql(`delete from app.rewards where id = :'id'::uuid;`, { id: ID });
  for (const id of RACE_IDS) runSql(`delete from app.rewards where id = :'id'::uuid;`, { id });
});

describe('admin', () => {
  beforeAll(() => {
    current.client = adminClient;
  });

  it('creates a reward and gets the stored row back', async () => {
    await expect(
      service.create({ id: ID, name: ` ${NAME} `, points: 80, active: true }),
    ).resolves.toEqual({ ok: true, reward: { id: ID, name: NAME, points: 80, active: true } });
  });

  it('resending the same id returns the same row, even with other values', async () => {
    await expect(
      service.create({ id: ID, name: `Altro nome ${SUFFIX}`, points: 5, active: false }),
    ).resolves.toEqual({ ok: true, reward: { id: ID, name: NAME, points: 80, active: true } });
    expect(runSql(`select count(*) from app.rewards where id = :'id'::uuid;`, { id: ID })).toBe(
      '1',
    );
  });

  it('a new reward with the same name in capitals is name-taken', async () => {
    await expect(
      service.create({ id: randomUUID(), name: NAME.toUpperCase(), points: 80, active: true }),
    ).resolves.toEqual({ ok: false, error: 'name-taken' });
  });

  it('values outside the limits are invalid', async () => {
    await expect(service.update(ID, { name: NAME, points: 0 })).resolves.toEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('an unknown id is not-found', async () => {
    await expect(service.setActive(randomUUID(), false)).resolves.toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('lists the new reward among the active ones, in sortRewards() order', async () => {
    const active = await service.listActive();
    expect(active.map((reward) => reward.id)).toContain(ID);
    expect(active.every((reward) => reward.active)).toBe(true);
    const all = await service.listAll();
    expect(all.find((reward) => reward.id === ID)).toEqual({
      id: ID,
      name: NAME,
      points: 80,
      active: true,
    });
    // The seed's inactive reward is in the whole catalog, after every active one.
    const firstInactive = all.findIndex((reward) => !reward.active);
    expect(firstInactive).toBeGreaterThan(0);
    expect(all.slice(firstInactive).every((reward) => !reward.active)).toBe(true);
  });

  it('a deactivated reward leaves listActive() and comes back when reactivated', async () => {
    await expect(service.setActive(ID, false)).resolves.toMatchObject({
      ok: true,
      reward: { id: ID, active: false },
    });
    expect((await service.listActive()).map((reward) => reward.id)).not.toContain(ID);
    expect((await service.listAll()).find((reward) => reward.id === ID)?.active).toBe(false);

    await expect(service.setActive(ID, true)).resolves.toMatchObject({
      ok: true,
      reward: { active: true },
    });
    expect((await service.listActive()).map((reward) => reward.id)).toContain(ID);
  });

  it('renames and changes the points without touching active', async () => {
    await expect(service.update(ID, { name: `${NAME} grande`, points: 120 })).resolves.toEqual({
      ok: true,
      reward: { id: ID, name: `${NAME} grande`, points: 120, active: true },
    });
  });
});

describe('concurrent creation', () => {
  const HOLD_SECONDS = '1.5';

  beforeAll(() => {
    current.client = adminClient;
  });

  /**
   * Inserts a reward in a transaction kept open for HOLD_SECONDS and resolves once the row is
   * inserted (the session is sleeping); `done` settles when it has committed.
   */
  async function holdInsert(row: { id: string; name: string; points: number }) {
    const marker = `race-${randomUUID()}`;
    const done = runSqlInBackground(
      `begin;
       insert into app.rewards (id, name, points, active, created_by, updated_by)
       select :'id'::uuid, :'name', :'points'::int, true, o.id, o.id
       from app.operators o where o.role = 'admin' order by o.created_at limit 1;
       select pg_sleep(${HOLD_SECONDS}) /* ${marker} */;
       commit;`,
      { id: row.id, name: row.name, points: String(row.points) },
    );
    await vi.waitFor(
      () => {
        const sleeping = runSql(
          `select count(*) from pg_stat_activity
           where pid <> pg_backend_pid() and query like '%pg_sleep%' and query like :'pattern';`,
          { pattern: `%${marker}%` },
        );
        if (sleeping !== '1') throw new Error('The held transaction has not inserted its row yet');
      },
      { timeout: 2000, interval: 20 },
    );
    return { done };
  }

  it('a resend while the first request is still open returns the first row, not an error', async () => {
    const id = randomUUID();
    RACE_IDS.push(id);
    const name = `Spremuta concorrente ${SUFFIX}`;
    const { done } = await holdInsert({ id, name, points: 40 });

    const resend = await service.create({ id, name, points: 40, active: true });
    await done;

    expect(resend).toEqual({ ok: true, reward: { id, name, points: 40, active: true } });
    expect(runSql(`select count(*) from app.rewards where id = :'id'::uuid;`, { id })).toBe('1');
  });
});

describe('operator', () => {
  beforeAll(() => {
    current.client = operatorClient;
  });

  it('reads the active rewards', async () => {
    const active = await service.listActive();
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((reward) => reward.active)).toBe(true);
    expect(active.map((reward) => reward.name)).toContain('Caffè');
  });

  it('is forbidden from every write, even a resend of an existing id', async () => {
    const forbidden = { ok: false, error: 'forbidden' };
    await expect(service.create({ id: ID, name: NAME, points: 80, active: true })).resolves.toEqual(
      forbidden,
    );
    await expect(
      service.create({ id: randomUUID(), name: `Operatore ${SUFFIX}`, points: 10, active: true }),
    ).resolves.toEqual(forbidden);
    await expect(service.update(ID, { name: NAME, points: 80 })).resolves.toEqual(forbidden);
    await expect(service.setActive(ID, false)).resolves.toEqual(forbidden);
    expect(
      runSql(
        `select name || '/' || points || '/' || active from app.rewards where id = :'id'::uuid;`,
        {
          id: ID,
        },
      ),
    ).toBe(`${NAME} grande/120/true`);
  });
});
