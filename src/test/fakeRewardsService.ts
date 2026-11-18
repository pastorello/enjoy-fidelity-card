import { vi } from 'vitest';
import { sortRewards } from '../features/rewards/sortRewards';
import type {
  Reward,
  RewardWriteError,
  RewardWriteResult,
  RewardsService,
} from '../features/rewards/types';

type Method = keyof RewardsService;
type WriteMethod = 'create' | 'update' | 'setActive';

/**
 * What a programmed call does instead of answering: a write resolves with that refusal and a
 * read rejects with a plain `Error`, without changing anything; an `Error` (a `ServerFaultError`,
 * say) is thrown as it is; `'lost'`: the call reaches the server and is applied, but the answer
 * never arrives (a write resolves with `network`, a read rejects).
 */
export type FakeRewardsFailure = RewardWriteError | 'lost' | Error;

/** One logged call: the method and the arguments it received (the ids included). */
export type FakeRewardsCall = { method: Method; args: unknown[] };

type FakeOptions = {
  rewards?: Reward[];
  /** The caller's role: an operator gets `forbidden` from every write, like on the server. */
  role?: 'admin' | 'operator';
};

// The `check` constraints of `app.rewards`.
const NAME_MAX = 60;
const POINTS_MAX = 99999;
let nextFixture = 0;

/** A catalog reward as the server returns it, with a fresh UUID-shaped id; for the `rewards` option. */
export function fakeReward(overrides: Partial<Reward> = {}): Reward {
  nextFixture += 1;
  return {
    id: `00000000-0000-4000-9000-${String(nextFixture).padStart(12, '0')}`,
    name: `Premio prova ${nextFixture}`,
    points: 100,
    active: true,
    ...overrides,
  };
}

/** `private.trim_spaces(name)`: the server trims every outer Unicode space, as `\s` does. */
function trimSpaces(name: string): string {
  return name.replace(/^\s+|\s+$/g, '');
}

/** The key of the `rewards_name_key` index, `lower(name)`. */
function nameKey(name: string): string {
  return name.toLowerCase();
}

function copy(reward: Reward): Reward {
  return { ...reward };
}

function validName(name: string): boolean {
  const length = Array.from(name).length;
  return length >= 1 && length <= NAME_MAX;
}

function validPoints(points: number): boolean {
  return Number.isInteger(points) && points >= 1 && points <= POINTS_MAX;
}

function refused(error: RewardWriteError): RewardWriteResult {
  return { ok: false, error };
}

function perMethod<T>(make: () => T): Record<Method, T> {
  return {
    listAll: make(),
    listActive: make(),
    create: make(),
    update: make(),
    setActive: make(),
  };
}

/**
 * In-memory RewardsService for component tests, following the server's rules and order of checks
 * (role, then idempotency or existence, then values, then the unique name on `lower(name)`):
 * `create` is idempotent on the id the app sends, so a resent request returns the saved row.
 * Every method is a `vi.fn` and every call is also logged in `calls`. `failNext` programs a
 * failure (also an answer lost after the write was applied), `holdNext` delays an answer until
 * released (answers out of order), `setNetworkDown` makes every call fail with `network`.
 */
export function createFakeRewardsService({
  rewards: initial = [],
  role = 'admin',
}: FakeOptions = {}) {
  const stored = new Map(initial.map((reward) => [reward.id, copy(reward)]));
  let networkDown = false;
  const failures = perMethod<FakeRewardsFailure[]>(() => []);
  const holds = perMethod<Promise<void>[]>(() => []);
  const calls: FakeRewardsCall[] = [];

  function nameTaken(name: string, except: string | null): boolean {
    const key = nameKey(name);
    for (const reward of stored.values()) {
      if (reward.id !== except && nameKey(reward.name) === key) return true;
    }
    return false;
  }

  /** Logs the call, then answers it as programmed (network, failure, hold) or with `compute`. */
  function run<T>(
    method: Method,
    args: unknown[],
    compute: () => T,
    fail: (error: RewardWriteError) => T,
  ) {
    calls.push({ method, args });
    const failure = failures[method].shift();
    const hold = holds[method].shift();
    const down = networkDown;
    // Built only when it is due, so a held rejection is never left unhandled meanwhile.
    const answer = async (): Promise<T> => {
      if (down) return fail('network');
      if (failure instanceof Error) throw failure;
      if (failure !== undefined && failure !== 'lost') return fail(failure);
      const result = compute();
      if (failure === 'lost') return fail('network');
      return result;
    };
    return hold ? hold.then(answer) : answer();
  }

  function read(method: Method, rows: () => Reward[]): Promise<Reward[]> {
    return run(
      method,
      [],
      () => sortRewards(rows()).map(copy),
      (error) => {
        // Like supabaseRewardsService: a read without a usable answer rejects with a plain Error.
        throw new Error(`Rewards not loaded (${error})`);
      },
    );
  }

  function write(method: WriteMethod, args: unknown[], compute: () => RewardWriteResult) {
    return run(method, args, () => (role === 'admin' ? compute() : refused('forbidden')), refused);
  }

  const service = {
    listAll: vi.fn<RewardsService['listAll']>(() => read('listAll', () => [...stored.values()])),
    listActive: vi.fn<RewardsService['listActive']>(() =>
      read('listActive', () => [...stored.values()].filter((reward) => reward.active)),
    ),
    create: vi.fn<RewardsService['create']>((input) =>
      write('create', [input], () => {
        // A resent request returns what the first one created, before any check of the values.
        const existing = stored.get(input.id);
        if (existing) return { ok: true, reward: copy(existing) };
        const name = trimSpaces(input.name);
        if (input.id === '' || !validName(name) || !validPoints(input.points)) {
          return refused('invalid');
        }
        if (nameTaken(name, null)) return refused('name-taken');
        const reward: Reward = { id: input.id, name, points: input.points, active: input.active };
        stored.set(reward.id, reward);
        return { ok: true, reward: copy(reward) };
      }),
    ),
    update: vi.fn<RewardsService['update']>((id, input) =>
      write('update', [id, input], () => {
        const reward = stored.get(id);
        if (!reward) return refused('not-found');
        const name = trimSpaces(input.name);
        if (!validName(name) || !validPoints(input.points)) return refused('invalid');
        if (nameTaken(name, id)) return refused('name-taken');
        Object.assign(reward, { name, points: input.points });
        return { ok: true, reward: copy(reward) };
      }),
    ),
    setActive: vi.fn<RewardsService['setActive']>((id, active) =>
      write('setActive', [id, active], () => {
        const reward = stored.get(id);
        if (!reward) return refused('not-found');
        reward.active = active;
        return { ok: true, reward: copy(reward) };
      }),
    ),
  } satisfies RewardsService;

  return {
    service,
    /** Every call, in order, with its arguments. */
    calls,
    /** The stored rewards, as copies, in insertion order. */
    rewards: () => [...stored.values()].map(copy),
    /** Programs the next call of `method` (queued: one failure per call, in order). */
    failNext: (method: Method, failure: FakeRewardsFailure) => {
      failures[method].push(failure);
    },
    /** Delays the answer of the next call of `method` until `release()`. */
    holdNext: (method: Method) => {
      let release!: () => void;
      holds[method].push(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return { release };
    },
    /** While down, every call fails with `network` and changes nothing. */
    setNetworkDown: (down: boolean) => {
      networkDown = down;
    },
  };
}
