import { homeSearchState, type HomeSearchState } from './homeSearch';

/**
 * Where "Indietro" of the customer page goes: back to the search it was opened from
 * (SPEC-customers Open Question 12), or to the plain home. The home's rows pass the text in the
 * navigation state: `<ListRow to="/clienti/<id>" state={customerBackState(text)} />`, and the back
 * link returns it to the home in its history state, never in the URL (SPEC-customers-v2 point 6).
 */
export type CustomerBackState = { backSearch: string };

export function customerBackState(search: string): CustomerBackState {
  return { backSearch: search };
}

/** The history state of the home for "Indietro": the search carried by `state`, or null. */
export function customerBackHomeState(state: unknown): HomeSearchState | null {
  if (typeof state !== 'object' || state === null || !('backSearch' in state)) return null;
  const { backSearch } = state;
  return typeof backSearch === 'string' ? homeSearchState(backSearch) : null;
}
