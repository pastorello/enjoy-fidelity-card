import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { supabaseRewardsService as service } from './supabaseRewardsService';
import type { Reward, RewardWriteResult } from './types';

type Answer = { data: unknown; error: unknown; status: number };

const db = vi.hoisted(() => ({
  schema: vi.fn<(name: string) => unknown>(),
  from: vi.fn<(table: string) => unknown>(),
  select: vi.fn<(columns: string) => unknown>(),
  eq: vi.fn<(column: string, value: unknown) => Promise<unknown>>(),
  rpc: vi.fn<(fn: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ schema: db.schema }),
}));

const ID = '6f1c2a5e-8b3d-4c7a-9e21-0d4b5f6a7c8e';

/** An `app.rewards` row as the RPCs and the select return it. */
const row = (name: string, points: number, active = true, id = ID) => ({
  id,
  name,
  points,
  active,
  created_at: '2026-11-18T09:00:00+00:00',
  created_by: '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b',
  updated_at: '2026-11-18T09:00:00+00:00',
  updated_by: '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b',
});
const reward: Reward = { id: ID, name: 'Spremuta', points: 80, active: true };

const pgError = (code: string, status: number, message = 'error'): Answer => ({
  data: null,
  error: { code, message, details: null, hint: null },
  status,
});

/** What supabase-js returns when the request never got an answer (failed fetch). */
const noResponse: Answer = {
  data: null,
  error: { code: '', message: 'TypeError: Failed to fetch', details: '', hint: '' },
  status: 0,
};

/** A select that resolves when awaited directly (listAll) or after `.eq()` (listActive). */
function selectAnswer(answer: Answer | Error) {
  const settle = () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));
  db.eq.mockImplementation(settle);
  db.select.mockImplementation(() => {
    // Like supabase-js's query builder: awaitable itself, or narrowed with .eq() first.
    const query = settle();
    // listActive() never awaits the unfiltered query: keep its rejection from going unhandled.
    query.catch(() => undefined);
    return Object.assign(query, { eq: db.eq });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  db.schema.mockReturnValue({ from: db.from, rpc: db.rpc });
  db.from.mockReturnValue({ select: db.select });
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
}

const seed = [
  row('Aperitivo', 200, true, 'a'),
  row('Dolce del giorno', 120, false, 'b'),
  row('Caffè', 50, true, 'c'),
  row('Cornetto e cappuccino', 100, true, 'd'),
];

describe('listAll', () => {
  it('reads app.rewards and returns every reward in sortRewards() order', async () => {
    selectAnswer({ data: seed, error: null, status: 200 });
    const rewards = await service.listAll();
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.from).toHaveBeenCalledWith('rewards');
    expect(db.select).toHaveBeenCalledWith('id, name, points, active');
    expect(db.eq).not.toHaveBeenCalled();
    expect(rewards.map((item) => item.name)).toEqual([
      'Caffè',
      'Cornetto e cappuccino',
      'Aperitivo',
      'Dolce del giorno',
    ]);
    expect(rewards[0]).toEqual({ id: 'c', name: 'Caffè', points: 50, active: true });
  });
});

describe('listActive', () => {
  it('asks the server only for active = true and sorts by points, then name', async () => {
    selectAnswer({
      data: [row('Cornetto e cappuccino', 100, true, 'd'), row('Caffè', 50, true, 'c')],
      error: null,
      status: 200,
    });
    const rewards = await service.listActive();
    expect(db.from).toHaveBeenCalledWith('rewards');
    expect(db.eq).toHaveBeenCalledWith('active', true);
    expect(rewards.map((item) => item.name)).toEqual(['Caffè', 'Cornetto e cappuccino']);
  });
});

describe.each([
  ['listAll', () => service.listAll()],
  ['listActive', () => service.listActive()],
] as const)('%s failures', (_name, run) => {
  it('a failed fetch rejects with a plain error, not a server fault', async () => {
    selectAnswer(noResponse);
    const error = await rejection(run());
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ServerFaultError);
  });

  it('a throwing request rejects with a plain error', async () => {
    selectAnswer(new TypeError('Failed to fetch'));
    const error = await rejection(run());
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ServerFaultError);
  });

  it.each([
    ['PGRST205', 404, 'Could not find the table', 'misconfigured'],
    ['42501', 401, 'permission denied for table rewards', 'misconfigured'],
    ['PGRST002', 503, 'Could not query the database for the schema cache', 'unavailable'],
  ])('%s (HTTP %i) is a ServerFaultError', async (code, status, message, kind) => {
    selectAnswer(pgError(code, status, message));
    const error = await rejection(run());
    expect(error).toBeInstanceOf(ServerFaultError);
    expect(error).toMatchObject({ kind });
  });

  it('a row of unexpected shape rejects', async () => {
    selectAnswer({ data: [{ ...row('Caffè', 50), points: '50' }], error: null, status: 200 });
    await expect(run()).rejects.toBeInstanceOf(Error);
  });

  it('an answer that is not an array rejects', async () => {
    selectAnswer({ data: row('Caffè', 50), error: null, status: 200 });
    await expect(run()).rejects.toBeInstanceOf(Error);
  });
});

/** Every write, with the RPC and arguments it must send. */
const writes = [
  {
    name: 'create',
    run: () => service.create({ id: ID, name: 'Spremuta', points: 80, active: true }),
    rpc: ['create_reward', { p_id: ID, p_name: 'Spremuta', p_points: 80, p_active: true }],
  },
  {
    name: 'update',
    run: () => service.update(ID, { name: 'Spremuta', points: 80 }),
    rpc: ['update_reward', { p_id: ID, p_name: 'Spremuta', p_points: 80 }],
  },
  {
    name: 'setActive',
    run: () => service.setActive(ID, true),
    rpc: ['set_reward_active', { p_id: ID, p_active: true }],
  },
] as const;

const failed = (result: RewardWriteResult) => (result.ok ? 'ok' : result.error);

describe.each(writes)('$name', ({ run, rpc }) => {
  it('calls its app RPC and maps the returned row to a Reward', async () => {
    db.rpc.mockResolvedValue({ data: row('Spremuta', 80), error: null, status: 200 });
    await expect(run()).resolves.toEqual({ ok: true, reward });
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.rpc).toHaveBeenCalledWith(...rpc);
  });

  it.each([
    ['42501', 403, 'Only an admin can change the rewards', 'forbidden'],
    ['42501', 403, 'No acting operator for this write', 'forbidden'],
    [
      '23505',
      409,
      'duplicate key value violates unique constraint "rewards_name_key"',
      'name-taken',
    ],
    ['23505', 409, 'duplicate key value violates unique constraint "rewards_pkey"', 'unknown'],
    ['23514', 400, 'points must be between 1 and 99999, got 0', 'invalid'],
    ['P0002', 404, `Reward ${ID} not found`, 'not-found'],
    ['22P02', 400, 'invalid input syntax for type uuid', 'unknown'],
    ['PGRST301', 401, 'JWT expired', 'unknown'],
    ['XX000', 500, 'internal error', 'unknown'],
  ])('%s (HTTP %i, "%s") is %s', async (code, status, message, error) => {
    db.rpc.mockResolvedValue(pgError(code, status, message));
    expect(failed(await run())).toBe(error);
  });

  it('a failed fetch is network', async () => {
    db.rpc.mockResolvedValue(noResponse);
    expect(failed(await run())).toBe('network');
  });

  it('a throwing call is network', async () => {
    db.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(failed(await run())).toBe('network');
  });

  it.each([
    ['42501', 401, 'permission denied for function create_reward', 'misconfigured'],
    ['PGRST202', 404, 'Could not find the function', 'misconfigured'],
    ['PGRST106', 406, 'Invalid schema: app', 'misconfigured'],
    ['PGRST002', 503, 'Could not query the database for the schema cache', 'unavailable'],
    ['', 503, 'Service Unavailable', 'unavailable'],
  ])('%s (HTTP %i) rejects with a ServerFaultError', async (code, status, message, kind) => {
    db.rpc.mockResolvedValue(pgError(code, status, message));
    const error = await rejection(run());
    expect(error).toBeInstanceOf(ServerFaultError);
    expect(error).toMatchObject({ kind });
  });

  it('a returned row of unexpected shape is unknown', async () => {
    db.rpc.mockResolvedValue({ data: { ...row('Spremuta', 80), active: 'yes' }, error: null });
    expect(failed(await run())).toBe('unknown');
  });
});
