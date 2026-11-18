/**
 * Where "Indietro" of the customer page goes: back to the search it was opened from (`/?q=…`,
 * SPEC-customers Open Question 12), or to the plain home. The home's search rows pass the text in
 * the navigation state: `<ListRow to="/clienti/<id>" state={customerBackState(text)} />`.
 */
export type CustomerBackState = { backSearch: string };

export function customerBackState(search: string): CustomerBackState {
  return { backSearch: search };
}

/** The home with the search carried by a location state, or the plain home for any other state. */
export function customerBackTo(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('backSearch' in state)) return '/';
  const { backSearch } = state;
  if (typeof backSearch !== 'string' || backSearch.trim() === '') return '/';
  return `/?${new URLSearchParams({ q: backSearch }).toString()}`;
}
