import { vi } from 'vitest';
import { createCardReader } from '../features/card-input/cardReader';
import { createKeyboardWedge } from '../features/card-input/keyboardWedge';
import { createWebNfcAdapter } from '../features/card-input/webNfcAdapter';
import { createFakeWebNfc } from './fakeWebNfc';

/**
 * The card-reading service of `renderApp`: the real service and keyboard wedge (listening on jsdom's
 * `document`) with `fakeWebNfc` in place of Chrome's Web NFC. `activate` and `deactivate` are spied on,
 * so tests check when reading is on (SPEC-card-input, success criterion 7).
 */
export function createTestCardReader(options: Parameters<typeof createFakeWebNfc>[0] = {}) {
  const nfc = createFakeWebNfc(options);
  const reader = createCardReader({
    now: () => Date.now(),
    vibrate: vi.fn<(ms: number) => boolean>(() => true),
    adapters: [],
    usb: createKeyboardWedge({ target: document, now: () => Date.now() }),
    nfc: createWebNfcAdapter(nfc.api),
  });
  const activate = vi.spyOn(reader, 'activate');
  const deactivate = vi.spyOn(reader, 'deactivate');
  return { reader, nfc, activate, deactivate };
}

export type TestCardReader = ReturnType<typeof createTestCardReader>;
