import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Icon } from '../../shared/ui/Icon';
import { readHomeNotice } from './homeNotice';
import styles from './NavigationNotice.module.css';

/** A live region is read only when its text changes after it is on the page. */
const NOTICE_DELAY_MS = 100;

/** The location state without its one-time message; null when nothing else is left. */
function withoutNotice(state: unknown): unknown {
  if (typeof state !== 'object' || state === null) return null;
  const rest: Record<string, unknown> = { ...state };
  delete rest.notice;
  return Object.keys(rest).length === 0 ? null : rest;
}

/**
 * The one-time message of the navigation state (`homeNotice.ts`): kept for as long as the page is
 * open, dropped at once from the history entry (the rest of the state stays) so "Indietro" or a
 * reload does not show it again.
 */
export function useNavigationNotice(): { notice: string | null; written: boolean } {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice] = useState(() => readHomeNotice(location.state));
  // The status row is mounted empty and the message written a moment later, so it is read out.
  const [written, setWritten] = useState(false);
  useEffect(() => {
    if (notice === null) return undefined;
    const timer = window.setTimeout(() => setWritten(true), NOTICE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const { pathname, search, hash, state } = location;
  useEffect(() => {
    // Once dropped, the state has no message: this does not run again.
    if (readHomeNotice(state) === null) return;
    void navigate({ pathname, search, hash }, { replace: true, state: withoutNotice(state) });
  }, [navigate, pathname, search, hash, state]);
  return { notice, written };
}

/**
 * The one-time message of the navigation state ("Dati del cliente cancellati.", "Card …A1B2
 * associata.") in a `role="status"` row with a check mark, at the top of the page.
 */
export function NavigationNotice() {
  const { notice, written } = useNavigationNotice();
  if (notice === null) return null;
  return (
    <output className={written ? styles.notice : 'visually-hidden'}>
      {written && (
        <>
          <Icon name="check" size={20} />
          {notice}
        </>
      )}
    </output>
  );
}
