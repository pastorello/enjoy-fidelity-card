import { getSupabase } from '../../../lib/supabase';

// The public page's only access to the server: public.card_points with the anon key (or the
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

function pointsOf({ data, error, status }: Answer): number | null {
  if (error || status === 0) throw new CardPointsUnavailableError();
  if (data === null) return null;
  if (typeof data === 'number' && Number.isSafeInteger(data) && data >= 0) return data;
  throw new CardPointsUnavailableError();
}

/**
 * The points of the card whose link carries `token`, or null when the link shows none (unknown,
 * malformed, pending, deactivated card, anonymized customer: the server answers the same null).
 * A malformed token answers null without calling the server.
 */
export async function fetchCardPoints(token: string): Promise<number | null> {
  if (!isCardToken(token)) return null;

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
      .rpc('card_points', { p_token: token })
      .abortSignal(controller.signal);
    const answer = await Promise.race([
      Promise.resolve(request).then(
        (value: Answer) => value,
        () => {
          throw new CardPointsUnavailableError();
        },
      ),
      timeout,
    ]);
    return pointsOf(answer);
  } finally {
    clearTimeout(timer);
  }
}
