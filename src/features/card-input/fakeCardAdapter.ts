import type { CardInputAdapter, DeliverRaw } from './cardReader';

declare global {
  interface Window {
    /** E2E build only: puts the card `uid` on the phone (SPEC-card-input, point 7). */
    __enjoyFakeCard?: (uid: string) => void;
  }
}

/** Where the fake installs its entry point: `window` in the E2E build. */
export type FakeCardHost = Pick<Window, '__enjoyFakeCard'>;

/**
 * The E2E card reader (SPEC-card-input, point 7): `window.__enjoyFakeCard(uid)` hands `uid` to the
 * service as a `'fake'` read in `'hex'`, under the same rules as the real inputs (normalization,
 * repeats, consumer on top, vibration). It reads only while the service is active, whatever the Web
 * NFC status. Installed by `main.tsx` only when `VITE_E2E === '1'`: never part of the normal build.
 */
export function createFakeCardAdapter(host: FakeCardHost): CardInputAdapter {
  let deliver: DeliverRaw | null = null;
  host.__enjoyFakeCard = (uid: string) => {
    deliver?.(uid, 'hex', 'fake');
  };
  return {
    start(ports) {
      deliver = ports.deliver;
    },
    stop() {
      deliver = null;
    },
  };
}
