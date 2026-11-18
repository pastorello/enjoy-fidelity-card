import { useSyncExternalStore } from 'react';

/** The 1280×800 cash-desk tablet in landscape; the 390×844 phone never matches. */
export const TABLET_LAYOUT_QUERY = '(min-width: 1024px) and (min-height: 600px)';

function mediaQuery(): MediaQueryList | undefined {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(TABLET_LAYOUT_QUERY)
    : undefined;
}

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery();
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

function isTablet(): boolean {
  return mediaQuery()?.matches ?? false;
}

/**
 * Whether the screen gets the tablet layout (SPEC-tablet-kiosk, Code Style): tablet layouts are CSS
 * and composition variants of the same pages, chosen by this hook and kept in step with resizes.
 * Without matchMedia the phone layout is the safe default.
 */
export function useTabletLayout(): boolean {
  return useSyncExternalStore(subscribe, isTablet, () => false);
}
