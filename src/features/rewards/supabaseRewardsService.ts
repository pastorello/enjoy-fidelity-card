import { ServerFaultError, serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import { sortRewards } from './sortRewards';
import type { Reward, RewardWriteError, RewardWriteResult, RewardsService } from './types';

// The only module that reads app.rewards or calls the rewards RPCs (scripts/rewardsBoundary.test.ts).

const COLUMNS = 'id, name, points, active';

/** The parts of a supabase-js answer this module looks at. */
type Answer = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  status?: number;
};

/**
 * The SQLSTATEs the rewards RPCs answer with (docs/specs/SPEC-rewards.md, "Modello dati") and their
 * translation. 23505 is raised by the `rewards_name_key` index, not by a `raise`; the boundary test
 * checks that every errcode the migration raises is listed here.
 */
export const REWARD_ERRCODES: Readonly<Record<string, RewardWriteError>> = {
  '42501': 'forbidden',
  '23505': 'name-taken',
  '23514': 'invalid',
  P0002: 'not-found',
};

/** Raised by a read that got no usable answer; `useRewards()` words it as a connection problem. */
function loadFailure(reason: string): Error {
  return new Error(`Rewards not loaded (${reason})`);
}

/** Maps an `app.rewards` row, or null when its shape is unexpected. */
function toReward(data: unknown): Reward | null {
  if (typeof data !== 'object' || data === null) return null;
  const { id, name, points, active }: Record<string, unknown> = { ...data };
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof points !== 'number' ||
    !Number.isInteger(points) ||
    typeof active !== 'boolean'
  ) {
    return null;
  }
  return { id, name, points, active };
}

/** The translation of a refused write; a 23505 on any other constraint is not a taken name. */
function writeErrorFor(error: NonNullable<Answer['error']>): RewardWriteError {
  const code = error.code ?? '';
  if (!Object.hasOwn(REWARD_ERRCODES, code)) return 'unknown';
  if (code === '23505' && !(error.message ?? '').includes('rewards_name_key')) return 'unknown';
  return REWARD_ERRCODES[code] ?? 'unknown';
}

async function write(fn: string, args: Record<string, unknown>): Promise<RewardWriteResult> {
  let answer: Answer;
  try {
    answer = await getSupabase().schema('app').rpc(fn, args);
  } catch {
    return { ok: false, error: 'network' };
  }
  const { error, status } = answer;
  if (error) {
    // supabase-js answers a failed fetch with status 0 instead of throwing.
    if (status === 0) return { ok: false, error: 'network' };
    // A missing grant (42501 "permission denied for function") is the server's fault, not a refusal.
    const fault = serverFaultFor(error, status ?? 0);
    if (fault) throw new ServerFaultError(fault);
    return { ok: false, error: writeErrorFor(error) };
  }
  const reward = toReward(answer.data);
  return reward ? { ok: true, reward } : { ok: false, error: 'unknown' };
}

async function list(onlyActive: boolean): Promise<Reward[]> {
  let answer: Answer;
  try {
    const query = getSupabase().schema('app').from('rewards').select(COLUMNS);
    answer = await (onlyActive ? query.eq('active', true) : query);
  } catch {
    throw loadFailure('network');
  }
  const { error, status } = answer;
  if (error) {
    if (status === 0) throw loadFailure('network');
    const fault = serverFaultFor(error, status ?? 0);
    if (fault) throw new ServerFaultError(fault);
    throw loadFailure(error.code || 'unknown');
  }
  if (!Array.isArray(answer.data)) throw loadFailure('unexpected answer');
  const rows: unknown[] = answer.data;
  const rewards = rows.map(toReward);
  if (rewards.some((reward) => reward === null)) throw loadFailure('unexpected row');
  return sortRewards(rewards.filter((reward) => reward !== null));
}

export const supabaseRewardsService: RewardsService = {
  listAll() {
    return list(false);
  },

  listActive() {
    return list(true);
  },

  create({ id, name, points, active }) {
    return write('create_reward', { p_id: id, p_name: name, p_points: points, p_active: active });
  },

  update(id, { name, points }) {
    return write('update_reward', { p_id: id, p_name: name, p_points: points });
  },

  setActive(id, active) {
    return write('set_reward_active', { p_id: id, p_active: active });
  },
};
