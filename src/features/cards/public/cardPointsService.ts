import { getSupabase } from '../../../lib/supabase';

// The public page's only access to the server: public.card_points and public.card_rewards with the anon key (or the
// session on the device, which changes nothing). The token travels in the body of a POST, never in
// the request URL; no message this module produces carries it.

/** After this long without an answer the page offers "Riprova", as for a network error. */
export const CARD_POINTS_TIMEOUT_MS = 8_000;

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** The secret of a card link: 22 base64url characters (16 random bytes). */
export function isCardToken(value: string): boolean {
  return TOKEN.test(value);
}

/** No usable answer: no network, a timeout, a server fault or an unexpected value. */
export class CardPointsUnavailableError extends Error {
  constructor() {
    super('The card points could not be loaded');
    this.name = 'CardPointsUnavailableError';
  }
}

type Answer = { data: unknown; error: unknown; status: number };

/** A reward of the bar's catalogue as the public page shows it: its name and its points only. */
export type PublicReward = { name: string; points: number };

/** Throws on anything but a usable answer; returns its data. */
function dataOf({ data, error, status }: Answer): unknown {
  if (error || status === 0) throw new CardPointsUnavailableError();
  return data;
}

function pointsOf(answer: Answer): number | null {
  const data = dataOf(answer);
  if (data === null) return null;
  if (typeof data === 'number' && Number.isSafeInteger(data) && data >= 0) return data;
  throw new CardPointsUnavailableError();
}

function rewardOf(row: unknown): PublicReward {
  if (typeof row !== 'object' || row === null || !('name' in row) || !('points' in row)) {
    throw new CardPointsUnavailableError();
  }
  const { name, points } = row;
  if (typeof name !== 'string' || name === '') throw new CardPointsUnavailableError();
  if (typeof points !== 'number' || !Number.isSafeInteger(points) || points < 0) {
    throw new CardPointsUnavailableError();
  }
  // Only these two fields reach the page, whatever else the row might carry.
  return { name, points };
}

function rewardsOf(answer: Answer): PublicReward[] {
  const data = dataOf(answer);
  if (!Array.isArray(data)) throw new CardPointsUnavailableError();
  return data.map(rewardOf);
}

/**
 * Calls the public function `name` with the token in the body of a POST; any failure, or no answer
 * within CARD_POINTS_TIMEOUT_MS (the request is then aborted), is a CardPointsUnavailableError.
 */
async function callPublic(name: 'card_points' | 'card_rewards', token: string): Promise<Answer> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CardPointsUnavailableError());
    }, CARD_POINTS_TIMEOUT_MS);
  });

  try {
    const request = getSupabase()
      .schema('public')
      .rpc(name, { p_token: token })
      .abortSignal(controller.signal);
    return await Promise.race([
      Promise.resolve(request).then(
        (value: Answer) => value,
        () => {
          throw new CardPointsUnavailableError();
        },
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The points of the card whose link carries `token`, or null when the link shows none (unknown,
 * malformed, pending, deactivated card, anonymized customer: the server answers the same null).
 * A malformed token answers null without calling the server.
 */
export async function fetchCardPoints(token: string): Promise<number | null> {
  if (!isCardToken(token)) return null;
  return pointsOf(await callPublic('card_points', token));
}

/**
 * The bar's active rewards, cheapest first as the server orders them, for the card whose link
 * carries `token`; an empty list when there are none or the link shows nothing (the server answers
 * zero rows for every link that shows no points). A malformed token answers [] without calling.
 */
export async function fetchCardRewards(token: string): Promise<PublicReward[]> {
  if (!isCardToken(token)) return [];
  return rewardsOf(await callPublic('card_rewards', token));
}
