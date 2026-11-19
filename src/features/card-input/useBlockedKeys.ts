import { useLayoutEffect } from 'react';

const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

function block(event: Event) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * While mounted, no key reaches the page: every key event stops on `window` in the capture phase,
 * before the USB wedge's `document` listener and before the browser presses a focused button with
 * Enter or Space. For /cassa, where the PIN goes in only by touch (SPEC-tablet-kiosk, point 3): the
 * tablet has no keyboard, the reader is the only source of keys. It lives here because listening to
 * the keyboard on the document belongs to this module (scripts/cardInputBoundary.test.ts). Added
 * in the layout phase, so a burst that lands right after the page commits is already stopped.
 */
export function useBlockedKeys(): void {
  useLayoutEffect(() => {
    for (const type of KEY_EVENTS) window.addEventListener(type, block, { capture: true });
    return () => {
      for (const type of KEY_EVENTS) window.removeEventListener(type, block, { capture: true });
    };
  }, []);
}
