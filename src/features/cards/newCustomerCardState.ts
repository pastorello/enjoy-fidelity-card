/**
 * The unknown card the home hands to Nuovo cliente, kept in the history state of that entry and
 * never in the URL (SPEC-customers-v2 point 6): the uid would otherwise end up in the browser
 * history and in the request logs. The history keeps it through a reload, as `?card=` did.
 */
export type NewCustomerCardState = { card: string };

/** The state that opens Nuovo cliente with the card `uid` (canonical). */
export function newCustomerCardState(uid: string): NewCustomerCardState {
  return { card: uid };
}

/** The card carried by a location state as it is (to normalize), or null for any other state. */
export function readNewCustomerCard(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('card' in state)) return null;
  const { card } = state;
  return typeof card === 'string' ? card : null;
}
