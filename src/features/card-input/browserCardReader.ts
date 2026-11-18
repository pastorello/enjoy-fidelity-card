import { createCardReader, type CardReader } from './cardReader';
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
 */
export function createBrowserCardReader(win: BrowserCardHost): CardReader {
  const navigator = win.navigator;
  return createCardReader({
    now: () => Date.now(),
    vibrate: typeof navigator.vibrate === 'function' ? (ms) => navigator.vibrate?.(ms) : undefined,
    adapters: [],
    usb: createKeyboardWedge({ target: win.document, now: () => Date.now() }),
    nfc: createWebNfcAdapter(createBrowserWebNfcApi(win)),
  });
}
