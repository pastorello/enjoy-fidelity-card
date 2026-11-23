/**
 * The text of the home search, kept in the history state of the home entry and never in the URL
 * (SPEC-customers-v2 point 6): an email typed there would otherwise end up in the browser history
 * and in the request logs. `navigate('.', { replace: true, state: homeSearchState(text) })` writes
 * it; the history keeps it through a reload and "Indietro" from the customer page.
 */
export type HomeSearchState = { q: string };

/** The state for the typed `text` as it is, or null when it is blank (the plain home). */
export function homeSearchState(text: string): HomeSearchState | null {
  return text.trim() === '' ? null : { q: text };
}

/** The text carried by a location state, or '' for any other state. */
export function readHomeSearch(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('q' in state)) return '';
  const { q } = state;
  return typeof q === 'string' ? q : '';
}
