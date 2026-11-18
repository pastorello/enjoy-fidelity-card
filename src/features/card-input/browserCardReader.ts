import { createCardReader, type CardInputAdapter, type CardReader } from './cardReader';
import { createKeyboardWedge } from './keyboardWedge';
import { createBrowserWebNfcApi, createWebNfcAdapter, type BrowserNfcHost } from './webNfcAdapter';

/** The parts of `window` the real reader uses; `window` itself satisfies it. */
export type BrowserCardHost = BrowserNfcHost & {
  readonly document: BrowserNfcHost['document'] & EventTarget;
  readonly navigator: BrowserNfcHost['navigator'] & { vibrate?: (pattern: number) => boolean };
};

/**
 * The card-reading service of `main.tsx`: Web NFC from the browser and the USB keyboard wedge on
 * `document`. Nothing starts here: `CardReaderSession` activates it once an operator is signed in.
 * `adapters` adds inputs started and stopped with the service (the E2E fake, in E2E builds only).
 */
export function createBrowserCardReader(
  win: BrowserCardHost,
  options: { adapters?: readonly CardInputAdapter[] } = {},
): CardReader {
  const navigator = win.navigator;
  return createCardReader({
    now: () => Date.now(),
    vibrate: typeof navigator.vibrate === 'function' ? (ms) => navigator.vibrate?.(ms) : undefined,
    adapters: options.adapters ?? [],
    usb: createKeyboardWedge({ target: win.document, now: () => Date.now() }),
    nfc: createWebNfcAdapter(createBrowserWebNfcApi(win)),
  });
}
