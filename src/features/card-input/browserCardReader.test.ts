import { describe, expect, it, vi } from 'vitest';
import type { CardRead } from './cardReader';
import { createBrowserCardReader, type BrowserCardHost } from './browserCardReader';
import type { NfcWriterLike } from './webNfcAdapter';

// SPEC-card-input, point 2: the service main.tsx builds. Invented uids only.

const UID = '04A1B2C3D4E5F6';
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A browser without Web NFC (iPhone, desktop): the 'nfc' permission is unknown. */
function hostWithoutNfc(vibrate?: (pattern: number) => boolean): BrowserCardHost {
  return {
    document,
    navigator: {
      permissions: { query: () => Promise.reject(new TypeError('Unknown permission: nfc')) },
      ...(vibrate ? { vibrate } : {}),
    },
  };
}

function burst(text: string): boolean {
  for (const key of text) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }
  return document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
}

describe('createBrowserCardReader', () => {
  it('starts nothing until activated, then reads the USB reader on document and vibrates', async () => {
    const vibrate = vi.fn<(pattern: number) => boolean>(() => true);
    const reader = createBrowserCardReader(hostWithoutNfc(vibrate));
    const onRead = vi.fn<(read: CardRead) => void>();
    const release = reader.pushConsumer(onRead);

    expect(burst(UID)).toBe(true);
    expect(onRead).not.toHaveBeenCalled();

    reader.activate({ usbFormat: 'hex' });
    await settle();
    expect(reader.getState().nfc).toBe('unsupported');
    expect(burst(UID)).toBe(false);
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ uid: UID, source: 'usb' }));
    expect(vibrate).toHaveBeenCalledWith(80);

    reader.deactivate();
    release();
    expect(burst(UID)).toBe(true);
  });

  it('starts and stops the extra adapters it is given (the E2E fake) with the service', () => {
    const extra = { start: vi.fn<() => void>(), stop: vi.fn<() => void>() };
    const reader = createBrowserCardReader(hostWithoutNfc(), { adapters: [extra] });
    expect(extra.start).not.toHaveBeenCalled();

    reader.activate({ usbFormat: null });
    expect(extra.start).toHaveBeenCalledOnce();
    reader.deactivate();
    expect(extra.stop).toHaveBeenCalledOnce();
  });

  it('can write with Chrome Web NFC active, never on a browser without it (point 5)', async () => {
    class StubReader extends EventTarget {
      onreading: NDEFReader['onreading'] = null;
      onreadingerror: NDEFReader['onreadingerror'] = null;
      scan() {
        return Promise.resolve();
      }
      write() {
        return Promise.resolve();
      }
    }
    const withNfc = createBrowserCardReader({
      NDEFReader: StubReader,
      document,
      navigator: { permissions: { query: () => Promise.resolve({ state: 'granted' }) } },
    });
    const withoutNfc = createBrowserCardReader(hostWithoutNfc());

    withNfc.activate({ usbFormat: null });
    withoutNfc.activate({ usbFormat: 'hex' });
    await settle();

    expect(withNfc.getState()).toMatchObject({ nfc: 'active', canWrite: true });
    expect(withoutNfc.getState()).toMatchObject({ nfc: 'unsupported', canWrite: false });
    withNfc.deactivate();
    withoutNfc.deactivate();
  });

  it('writes with the writer it is given (the E2E fake) instead of NDEFReader.write()', async () => {
    const scanners: StubReader[] = [];
    const nativeWrite = vi.fn<() => Promise<void>>(() => Promise.resolve());
    class StubReader extends EventTarget {
      onreading: NDEFReader['onreading'] = null;
      onreadingerror: NDEFReader['onreadingerror'] = null;
      constructor() {
        super();
        scanners.push(this);
      }
      scan() {
        return Promise.resolve();
      }
      write() {
        return nativeWrite();
      }
    }
    let supported = false;
    const write = vi.fn<NfcWriterLike['write']>(() => new Promise<void>(() => {}));
    const reader = createBrowserCardReader(
      {
        NDEFReader: StubReader,
        document,
        navigator: { permissions: { query: () => Promise.resolve({ state: 'granted' }) } },
      },
      { writer: { isWriteSupported: () => supported, createWriter: () => ({ write }) } },
    );
    reader.activate({ usbFormat: null });
    await settle();
    // The given writer decides whether the phone can write, not NDEFReader.
    expect(reader.getState()).toMatchObject({ nfc: 'active', canWrite: false });
    reader.deactivate();
    supported = true;
    reader.activate({ usbFormat: null });
    await settle();
    expect(reader.getState()).toMatchObject({ nfc: 'active', canWrite: true });
    const control = new AbortController();

    const result = reader.writeUrl('https://example.test/p/invented-token', {
      expectedUid: UID,
      signal: control.signal,
    });
    const reading = Object.assign(new Event('reading'), {
      serialNumber: '04:a1:b2:c3:d4:e5:f6',
      message: { records: [] },
    });
    scanners.at(-1)?.onreading?.(reading);

    expect(write).toHaveBeenCalledOnce();
    expect(nativeWrite).not.toHaveBeenCalled();
    control.abort();
    await expect(result).resolves.toEqual({ ok: false, reason: 'aborted' });
    reader.deactivate();
  });

  it('works on a browser without navigator.vibrate', async () => {
    const reader = createBrowserCardReader(hostWithoutNfc());
    const onRead = vi.fn<(read: CardRead) => void>();
    reader.pushConsumer(onRead);
    reader.activate({ usbFormat: 'hex' });
    await settle();

    expect(burst(UID)).toBe(false);
    expect(onRead).toHaveBeenCalledOnce();
    reader.deactivate();
  });
});
