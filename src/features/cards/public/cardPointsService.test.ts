import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_POINTS_TIMEOUT_MS,
  CardPointsUnavailableError,
  fetchCardPoints,
  fetchCardRewards,
  isCardToken,
} from './cardPointsService';

type Answer = { data: unknown; error: unknown; status: number };

const db = vi.hoisted(() => ({
  schema: vi.fn<(name: string) => unknown>(),
  rpc: vi.fn<(...args: unknown[]) => unknown>(),
  abortSignal: vi.fn<(signal: AbortSignal) => Promise<unknown>>(),
}));
vi.mock('../../../lib/supabase', () => ({
  getSupabase: () => ({ schema: db.schema }),
}));

const TOKEN = 'Zq3_x-9KpL2mN8vR4tY6wA';

function answers(answer: Answer | Promise<Answer>) {
  db.abortSignal.mockImplementation(() => Promise.resolve(answer));
}

beforeEach(() => {
  db.schema.mockReset().mockImplementation(() => ({ rpc: db.rpc }));
  db.rpc.mockReset().mockImplementation(() => ({ abortSignal: db.abortSignal }));
  db.abortSignal.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isCardToken', () => {
  it.each([
    ['22 base64url characters', TOKEN, true],
    ['21 characters', TOKEN.slice(1), false],
    ['23 characters', `${TOKEN}A`, false],
    ['a plus sign', `+${TOKEN.slice(1)}`, false],
    ['a slash', `/${TOKEN.slice(1)}`, false],
    ['padding', `${TOKEN.slice(2)}==`, false],
    ['empty', '', false],
  ])('%s → %s', (_label, token, expected) => {
    expect(isCardToken(token)).toBe(expected);
  });
});

describe('fetchCardPoints', () => {
  it('calls public.card_points in a POST, the token only in the body', async () => {
    answers({ data: 120, error: null, status: 200 });
    await expect(fetchCardPoints(TOKEN)).resolves.toBe(120);
    expect(db.schema).toHaveBeenCalledWith('public');
    // Two arguments only: never `{ get: true }`, which would put the token in the URL.
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('card_points', { p_token: TOKEN });
    expect(db.abortSignal).toHaveBeenCalledOnce();
  });

  it('answers 0 for a card without movements', async () => {
    answers({ data: 0, error: null, status: 200 });
    await expect(fetchCardPoints(TOKEN)).resolves.toBe(0);
  });

  it('answers null for a link that shows no points', async () => {
    answers({ data: null, error: null, status: 200 });
    await expect(fetchCardPoints(TOKEN)).resolves.toBeNull();
  });

  it('answers null for a malformed token without calling the server', async () => {
    await expect(fetchCardPoints('not-a-token')).resolves.toBeNull();
    await expect(fetchCardPoints(`${TOKEN}A`)).resolves.toBeNull();
    expect(db.schema).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [
      'no answer (status 0)',
      { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 },
    ],
    [
      'a server error',
      { data: null, error: { code: 'PGRST202', message: 'missing' }, status: 404 },
    ],
    ['an unavailable API', { data: null, error: { code: 'PGRST002' }, status: 503 }],
    ['a value that is not a count', { data: 'Maria', error: null, status: 200 }],
    ['a fraction', { data: 1.5, error: null, status: 200 }],
    ['a negative number', { data: -3, error: null, status: 200 }],
    ['an object', { data: { points: 3 }, error: null, status: 200 }],
  ])('rejects with CardPointsUnavailableError on %s', async (_label, answer) => {
    answers(answer);
    await expect(fetchCardPoints(TOKEN)).rejects.toBeInstanceOf(CardPointsUnavailableError);
  });

  it('rejects with CardPointsUnavailableError when the request throws', async () => {
    db.abortSignal.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(fetchCardPoints(TOKEN)).rejects.toBeInstanceOf(CardPointsUnavailableError);
  });

  it('gives up after 8 seconds and aborts the request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    db.abortSignal.mockImplementation((given) => {
      signal = given;
      return new Promise<never>(() => {});
    });
    const outcome = fetchCardPoints(TOKEN).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(CARD_POINTS_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toBeInstanceOf(CardPointsUnavailableError);
    expect(signal?.aborted).toBe(true);
    expect(CARD_POINTS_TIMEOUT_MS).toBe(8_000);
  });

  it('never puts the token in an error message', async () => {
    answers({ data: null, error: { message: `bad ${TOKEN}` }, status: 500 });
    const error = await fetchCardPoints(TOKEN).catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(TOKEN);
  });
});

describe('fetchCardRewards', () => {
  const REWARDS = [
    { name: 'Caffè', points: 50 },
    { name: 'Cornetto e cappuccino', points: 100 },
  ];

  it('calls public.card_rewards in a POST, the token only in the body, and keeps the order', async () => {
    answers({ data: REWARDS, error: null, status: 200 });
    await expect(fetchCardRewards(TOKEN)).resolves.toEqual(REWARDS);
    expect(db.schema).toHaveBeenCalledWith('public');
    // Two arguments only: never `{ get: true }`, which would put the token in the URL.
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('card_rewards', { p_token: TOKEN });
    expect(db.abortSignal).toHaveBeenCalledOnce();
  });

  it('answers an empty list for a link without rewards (or that shows none)', async () => {
    answers({ data: [], error: null, status: 200 });
    await expect(fetchCardRewards(TOKEN)).resolves.toEqual([]);
  });

  it('keeps only the name and the points of each row', async () => {
    answers({
      data: [{ name: 'Caffè', points: 50, id: 'e0000000-0000-4000-8000-000000000001' }],
      error: null,
      status: 200,
    });
    await expect(fetchCardRewards(TOKEN)).resolves.toEqual([{ name: 'Caffè', points: 50 }]);
  });

  it('answers an empty list for a malformed token without calling the server', async () => {
    await expect(fetchCardRewards('not-a-token')).resolves.toEqual([]);
    await expect(fetchCardRewards(`${TOKEN}A`)).resolves.toEqual([]);
    expect(db.schema).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [
      'no answer (status 0)',
      { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 },
    ],
    [
      'a server error',
      { data: null, error: { code: 'PGRST202', message: 'missing' }, status: 404 },
    ],
    ['null instead of a list', { data: null, error: null, status: 200 }],
    ['a number', { data: 3, error: null, status: 200 }],
    ['a row without a name', { data: [{ points: 50 }], error: null, status: 200 }],
    ['an empty name', { data: [{ name: '', points: 50 }], error: null, status: 200 }],
    ['a fraction of a point', { data: [{ name: 'Caffè', points: 1.5 }], error: null, status: 200 }],
    ['negative points', { data: [{ name: 'Caffè', points: -1 }], error: null, status: 200 }],
    ['points as text', { data: [{ name: 'Caffè', points: '50' }], error: null, status: 200 }],
    ['a row that is not an object', { data: ['Caffè'], error: null, status: 200 }],
  ])('rejects with CardPointsUnavailableError on %s', async (_label, answer) => {
    answers(answer);
    await expect(fetchCardRewards(TOKEN)).rejects.toBeInstanceOf(CardPointsUnavailableError);
  });

  it('rejects with CardPointsUnavailableError when the request throws', async () => {
    db.abortSignal.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(fetchCardRewards(TOKEN)).rejects.toBeInstanceOf(CardPointsUnavailableError);
  });

  it('gives up after the same 8 seconds and aborts the request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    db.abortSignal.mockImplementation((given) => {
      signal = given;
      return new Promise<never>(() => {});
    });
    const outcome = fetchCardRewards(TOKEN).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(CARD_POINTS_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toBeInstanceOf(CardPointsUnavailableError);
    expect(signal?.aborted).toBe(true);
  });

  it('never puts the token in an error message', async () => {
    answers({ data: null, error: { message: `bad ${TOKEN}` }, status: 500 });
    const error = await fetchCardRewards(TOKEN).catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(TOKEN);
  });
});
