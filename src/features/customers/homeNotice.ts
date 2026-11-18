/**
 * A one-time message for the home ("Dati del cliente cancellati."), passed in the navigation
 * state: `navigate('/', { replace: true, state: homeNoticeState('…') })`. The home shows it once
 * in a `role="status"` row at the top and drops it from the history entry.
 */
export type HomeNoticeState = { notice: string };

export function homeNoticeState(notice: string): HomeNoticeState {
  return { notice };
}

/** The message carried by a location state, or null for any other state. */
export function readHomeNotice(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null;
  const { notice } = state;
  return typeof notice === 'string' && notice.trim() !== '' ? notice : null;
}
