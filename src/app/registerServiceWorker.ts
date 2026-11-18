/**
 * PWA set-up (SPEC-cards point 9: no PWA for the customer). Replaces the `registerSW.js` that
 * vite-plugin-pwa used to inject on every page (`injectRegister: false` in vite.config.ts).
 *
 * On the operator pages: the service worker is registered after `load`, as registerSW.js did.
 * On the public points page (/s/:token): no service worker (the customer's phone does not cache
 * the whole app) and the install prompt is cancelled (Chrome does not offer "Enjoy Card").
 */

/** The window members this module touches, so tests can pass a plain object. */
export type PwaWindow = {
  location: { pathname: string };
  navigator: {
    serviceWorker?: { register: (url: string, options: RegistrationOptions) => Promise<unknown> };
  };
  addEventListener: (type: string, listener: (event: Event) => void) => void;
};

/** True on the public points page `/s/…` (and the bare `/s`), false on every operator page. */
export function isPublicCardPath(pathname: string): boolean {
  return pathname === '/s' || pathname.startsWith('/s/');
}

export function setUpServiceWorker(win: PwaWindow): void {
  // Checked when the event fires: the path is the one Chrome would offer to install from.
  win.addEventListener('beforeinstallprompt', (event) => {
    if (isPublicCardPath(win.location.pathname)) event.preventDefault();
  });

  if (isPublicCardPath(win.location.pathname)) return;
  const container = win.navigator.serviceWorker;
  if (!container) return;
  win.addEventListener('load', () => {
    // No offline mode: without the worker the app still works online, so a refusal is ignored.
    container.register('/sw.js', { scope: '/' }).catch(() => undefined);
  });
}
