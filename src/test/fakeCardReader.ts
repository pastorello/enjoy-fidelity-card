import { vi } from 'vitest';
import { createCardReader } from '../features/card-input/cardReader';
import { createKeyboardWedge } from '../features/card-input/keyboardWedge';
import { createWebNfcAdapter } from '../features/card-input/webNfcAdapter';
import { createFakeWebNfc } from './fakeWebNfc';

/**
 * The card-reading service of `renderApp`: the real service and keyboard wedge (listening on jsdom's
 * `document`) with `fakeWebNfc` in place of Chrome's Web NFC, for reading and writing. `activate` and
 * `deactivate` are spied on, so tests check when reading is on (SPEC-card-input, success criterion 7);
 * `vibrate` tells whether a read was delivered to a consumer.
 */
export function createTestCardReader(options: Parameters<typeof createFakeWebNfc>[0] = {}) {
  const nfc = createFakeWebNfc(options);
  const vibrate = vi.fn<(ms: number) => boolean>(() => true);
  const reader = createCardReader({
    now: () => Date.now(),
    vibrate,
    adapters: [],
    usb: createKeyboardWedge({ target: document, now: () => Date.now() }),
    nfc: createWebNfcAdapter(nfc.api),
    writer: nfc.api,
  });
  const activate = vi.spyOn(reader, 'activate');
  const deactivate = vi.spyOn(reader, 'deactivate');
  return { reader, nfc, activate, deactivate, vibrate };
}

export type TestCardReader = ReturnType<typeof createTestCardReader>;
