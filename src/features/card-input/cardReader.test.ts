import { describe, expect, it, vi } from 'vitest';
import {
  REPEAT_WINDOW_MS,
  createCardReader,
  type CardConsumer,
  type CardInputAdapter,
  type CardRead,
  type CardReaderOptions,
  type CardWriteTarget,
  type DeliverRaw,
  type NfcInputAdapter,
  type NfcStatus,
  type UsbInputAdapter,
} from './cardReader';

// SPEC-card-input, points 2 and 5; success criteria 5 and 7. Invented uids only.

const UID = '04A1B2C3D4E5F6';
const OTHER_UID = '04112233445566';

/** An adapter that records start/stop and lets the test push raw reads like a real one would. */
function fakeAdapter() {
  let deliver: DeliverRaw | null = null;
  const status = { running: false };
  const start = vi.fn<CardInputAdapter['start']>((ports) => {
    deliver = ports.deliver;
    status.running = true;
  });
  const stop = vi.fn<CardInputAdapter['stop']>(() => {
    status.running = false;
  });
  const adapter: CardInputAdapter = { start, stop };
  return {
    adapter,
    start,
    stop,
    status,
    /** Pushes a raw read through whatever `deliver` the service last handed to the adapter. */
    read(
      raw: string,
      format: Parameters<DeliverRaw>[1] = 'hex',
      source: Parameters<DeliverRaw>[2] = 'web-nfc',
    ) {
      deliver?.(raw, format, source);
    },
  };
}

function setup(options: Partial<CardReaderOptions> = {}) {
  let time = 1_000_000;
  const card = fakeAdapter();
  const vibrate = vi.fn<(ms: number) => void>();
  const reader = createCardReader({
    now: () => time,
    vibrate,
    adapters: [card.adapter],
    ...options,
  });
  return {
    reader,
    card,
    vibrate,
    advance: (ms: number) => {
      time += ms;
    },
    time: () => time,
  };
}

describe('createCardReader: consumer stack', () => {
  it('delivers only to the most recently pushed consumer', () => {
    const { reader, card } = setup();
    reader.activate({ usbFormat: null });
    const first = vi.fn<CardConsumer>();
    const second = vi.fn<CardConsumer>();
    reader.pushConsumer(first);
    reader.pushConsumer(second);

    card.read('04:a1:b2:c3:d4:e5:f6');

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('removing a consumer that is not on top does not change who receives', () => {
    const { reader, card } = setup();
    reader.activate({ usbFormat: null });
    const bottom = vi.fn<CardConsumer>();
    const middle = vi.fn<CardConsumer>();
    const top = vi.fn<CardConsumer>();
    reader.pushConsumer(bottom);
    const releaseMiddle = reader.pushConsumer(middle);
    reader.pushConsumer(top);

    releaseMiddle();
    card.read(UID);

    expect(top).toHaveBeenCalledTimes(1);
    expect(middle).not.toHaveBeenCalled();
    expect(bottom).not.toHaveBeenCalled();
  });

  it('gives the reads back to the previous consumer when the top one is released', () => {
    const { reader, card } = setup();
    reader.activate({ usbFormat: null });
    const below = vi.fn<CardConsumer>();
    const top = vi.fn<CardConsumer>();
    reader.pushConsumer(below);
    const releaseTop = reader.pushConsumer(top);

    releaseTop();
    card.read(UID);

    expect(below).toHaveBeenCalledTimes(1);
    expect(top).not.toHaveBeenCalled();
  });

  it('removes by identity: the same function pushed twice is two entries, released one at a time', () => {
    const { reader, card, advance } = setup();
    reader.activate({ usbFormat: null });
    const shared = vi.fn<CardConsumer>();
    const other = vi.fn<CardConsumer>();
    const releaseFirst = reader.pushConsumer(shared);
    reader.pushConsumer(other);
    reader.pushConsumer(shared);

    releaseFirst();
    card.read(UID);
    expect(shared).toHaveBeenCalledTimes(1);

    releaseFirst(); // releasing twice is harmless
    advance(REPEAT_WINDOW_MS + 1);
    card.read(UID);
    expect(shared).toHaveBeenCalledTimes(2);
    expect(other).not.toHaveBeenCalled();
  });

  it('a released consumer pushed again goes back on top', () => {
    const { reader, card } = setup();
    reader.activate({ usbFormat: null });
    const first = vi.fn<CardConsumer>();
    const second = vi.fn<CardConsumer>();
    const releaseFirst = reader.pushConsumer(first);
    reader.pushConsumer(second);

    releaseFirst();
    reader.pushConsumer(first);
    card.read(UID);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('hands the consumer the normalized uid, its source and the time', () => {
    const { reader, card, time } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<(read: CardRead) => void>();
    reader.pushConsumer(consumer);

    card.read('1303689068602870', 'dec', 'usb');

    expect(consumer).toHaveBeenCalledWith({ uid: UID, source: 'usb', at: time() });
  });
});

describe('createCardReader: repeat window', () => {
  it('ignores the same uid read again 1999 ms later', () => {
    const { reader, card, advance } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    card.read(UID);
    advance(1999);
    card.read('04:a1:b2:c3:d4:e5:f6'); // same uid, other spelling

    expect(consumer).toHaveBeenCalledTimes(1);
  });

  it('delivers the same uid read again 2001 ms later', () => {
    const { reader, card, advance } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    card.read(UID);
    advance(2001);
    card.read(UID);

    expect(consumer).toHaveBeenCalledTimes(2);
  });

  it('still ignores the same uid exactly 2000 ms later ("within 2000 ms")', () => {
    const { reader, card, advance } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    card.read(UID);
    advance(2000);
    card.read(UID);

    expect(consumer).toHaveBeenCalledTimes(1);
  });

  it('measures the window from the last read of that uid, delivered or not', () => {
    const { reader, card, advance } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();

    card.read(UID); // no consumer: discarded, but remembered
    reader.pushConsumer(consumer);
    advance(1500);
    card.read(UID);
    expect(consumer).not.toHaveBeenCalled();

    advance(1500); // 1500 ms after the ignored read, 3000 ms after the first one
    card.read(UID);
    expect(consumer).not.toHaveBeenCalled();

    advance(REPEAT_WINDOW_MS + 1);
    card.read(UID);
    expect(consumer).toHaveBeenCalledTimes(1);
  });

  it('delivers a different uid at once', () => {
    const { reader, card } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<(read: CardRead) => void>();
    reader.pushConsumer(consumer);

    card.read(UID);
    card.read(OTHER_UID);

    expect(consumer.mock.calls.map(([read]) => read.uid)).toEqual([UID, OTHER_UID]);
  });

  it('is 2000 ms', () => {
    expect(REPEAT_WINDOW_MS).toBe(2000);
  });
});

describe('createCardReader: vibration', () => {
  it('vibrates 80 ms when a read is delivered', () => {
    const { reader, card, vibrate } = setup();
    reader.activate({ usbFormat: null });
    reader.pushConsumer(vi.fn<CardConsumer>());

    card.read(UID);

    expect(vibrate).toHaveBeenCalledExactlyOnceWith(80);
  });

  it('discards a read without consumers silently, without vibrating', () => {
    const { reader, card, vibrate } = setup();
    reader.activate({ usbFormat: null });

    expect(() => card.read(UID)).not.toThrow();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does not vibrate for an ignored repeat', () => {
    const { reader, card, vibrate } = setup();
    reader.activate({ usbFormat: null });
    reader.pushConsumer(vi.fn<CardConsumer>());

    card.read(UID);
    card.read(UID);

    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('works without vibrate', () => {
    const { reader, card } = setup({ vibrate: undefined });
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    expect(() => card.read(UID)).not.toThrow();
    expect(consumer).toHaveBeenCalledTimes(1);
  });

  it('still delivers when vibrate throws', () => {
    const vibrate = vi.fn<(ms: number) => void>(() => {
      throw new Error('vibration refused');
    });
    const { reader, card } = setup({ vibrate });
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    expect(() => card.read(UID)).not.toThrow();
    expect(consumer).toHaveBeenCalledTimes(1);
  });
});

describe('createCardReader: invalid uids', () => {
  it.each([
    ['', 'hex'],
    ['04:a1:b', 'hex'],
    ['0g', 'hex'],
    ['00000000', 'hex'],
    ['04A1B2C3', 'dec'],
    ['04A1B2C3D4E5F6', 'unknown'],
  ])('discards %j in format %s without vibrating', (raw, format) => {
    const { reader, card, vibrate } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    card.read(raw, format);

    expect(consumer).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('an invalid read does not open a repeat window', () => {
    const { reader, card } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    card.read('not a uid');
    card.read(UID);

    expect(consumer).toHaveBeenCalledTimes(1);
  });
});

describe('createCardReader: activation (criterion 7)', () => {
  it('starts nothing and reads nothing before activate()', () => {
    const { reader, card, vibrate } = setup();
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    card.read(UID);

    expect(card.start).not.toHaveBeenCalled();
    expect(card.status.running).toBe(false);
    expect(consumer).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('starts every adapter on activate()', () => {
    const first = fakeAdapter();
    const second = fakeAdapter();
    const reader = createCardReader({ now: () => 0, adapters: [first.adapter, second.adapter] });

    reader.activate({ usbFormat: null });

    expect(first.start).toHaveBeenCalledTimes(1);
    expect(second.start).toHaveBeenCalledTimes(1);
    expect(reader.getState().usb.enabled).toBe(false);
  });

  it('stops the adapters on deactivate() and ignores what they still deliver', () => {
    const { reader, card, vibrate } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    reader.deactivate();
    card.read(UID);

    expect(card.stop).toHaveBeenCalledTimes(1);
    expect(card.status.running).toBe(false);
    expect(consumer).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does not start the adapters twice on a second activate()', () => {
    const { reader, card } = setup();
    reader.activate({ usbFormat: null });
    reader.activate({ usbFormat: 'dec' });

    expect(card.start).toHaveBeenCalledTimes(1);
    expect(reader.getState().usb.format).toBe('dec');
  });

  it('deactivate() without activate() does nothing', () => {
    const { reader, card } = setup();

    reader.deactivate();

    expect(card.stop).not.toHaveBeenCalled();
  });

  it('survives an activate/deactivate/activate cycle (StrictMode) with one running adapter', () => {
    const { reader, card } = setup();
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    reader.activate({ usbFormat: null });
    reader.deactivate();
    reader.activate({ usbFormat: null });
    card.read(UID);

    expect(card.start).toHaveBeenCalledTimes(2);
    expect(card.stop).toHaveBeenCalledTimes(1);
    expect(card.status.running).toBe(true);
    expect(consumer).toHaveBeenCalledTimes(1);
  });

  it('forgets the repeat window when deactivated (a new session reads the same card at once)', () => {
    const { reader, card } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    card.read(UID);
    reader.deactivate();
    reader.activate({ usbFormat: null });
    card.read(UID);

    expect(consumer).toHaveBeenCalledTimes(2);
  });

  it('keeps the consumer stack across deactivate/activate', () => {
    const { reader, card } = setup();
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    reader.activate({ usbFormat: null });
    reader.deactivate();
    reader.activate({ usbFormat: null });
    card.read(UID);

    expect(consumer).toHaveBeenCalledTimes(1);
  });
});

describe('createCardReader: state', () => {
  it('starts with the Web NFC status unknown, no writing and the USB reader off', () => {
    const { reader } = setup();

    expect(reader.getState()).toEqual({
      nfc: 'checking',
      canWrite: false,
      usb: { enabled: false, format: null, lastReadAt: null, lastInvalidAt: null },
    });
  });

  it('tracks the USB format and notifies subscribers', () => {
    const { reader } = setup();
    const listener = vi.fn<() => void>();
    const unsubscribe = reader.subscribe(listener);

    reader.activate({ usbFormat: null });
    reader.setUsbFormat('dec-reversed');

    expect(reader.getState().usb).toMatchObject({ enabled: true, format: 'dec-reversed' });
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    reader.setUsbFormat(null);
    expect(listener).not.toHaveBeenCalled();
    expect(reader.getState().usb).toMatchObject({ enabled: false, format: null });
  });

  it('keeps the USB reader off while the service is not active, whatever the format', () => {
    const { reader } = setup();

    reader.setUsbFormat('hex');
    expect(reader.getState().usb).toMatchObject({ enabled: false, format: 'hex' });

    reader.activate({ usbFormat: 'hex' });
    expect(reader.getState().usb.enabled).toBe(true);

    reader.deactivate();
    expect(reader.getState().usb.enabled).toBe(false);
  });

  it('returns the same state object until something changes (useSyncExternalStore)', () => {
    const { reader } = setup();
    const before = reader.getState();

    expect(reader.getState()).toBe(before);
    reader.activate({ usbFormat: 'hex' });
    expect(reader.getState()).not.toBe(before);
  });

  it('does not notify when the format does not change', () => {
    const { reader } = setup();
    reader.activate({ usbFormat: 'hex' });
    const listener = vi.fn<() => void>();
    reader.subscribe(listener);

    reader.setUsbFormat('hex');

    expect(listener).not.toHaveBeenCalled();
  });
});

function usbSetup() {
  const ports: { format: (() => string | null) | null; deliver: DeliverRaw | null } = {
    format: null,
    deliver: null,
  };
  const start = vi.fn<UsbInputAdapter['start']>((given) => {
    ports.format = given.format;
    ports.deliver = given.deliver;
  });
  const stop = vi.fn<UsbInputAdapter['stop']>();
  const time = { now: 5_000 };
  const reader = createCardReader({ now: () => time.now, adapters: [], usb: { start, stop } });
  return { reader, start, stop, ports, time };
}

describe('createCardReader: USB adapter (point 4)', () => {
  it('is not started while the format is null, nor before activate()', () => {
    const { reader, start } = usbSetup();

    reader.setUsbFormat('hex');
    reader.activate({ usbFormat: null });

    expect(start).not.toHaveBeenCalled();
  });

  it('starts once when active with a format and reads the current format', () => {
    const { reader, start, ports } = usbSetup();

    reader.activate({ usbFormat: 'dec' });
    reader.setUsbFormat('hex-reversed');

    expect(start).toHaveBeenCalledTimes(1);
    expect(ports.format?.()).toBe('hex-reversed');
  });

  it('stops when the format goes back to null and on deactivate()', () => {
    const { reader, start, stop } = usbSetup();
    reader.activate({ usbFormat: 'hex' });

    reader.setUsbFormat(null);
    expect(stop).toHaveBeenCalledTimes(1);

    reader.setUsbFormat('hex');
    reader.deactivate();
    expect(start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('keeps lastReadAt and lastInvalidAt of usb reads only, and notifies', () => {
    const { reader, ports, time } = usbSetup();
    const listener = vi.fn<() => void>();
    reader.subscribe(listener);
    reader.activate({ usbFormat: 'hex' });
    listener.mockClear();

    ports.deliver?.(UID, 'hex', 'usb');
    time.now += 10;
    ports.deliver?.('04A1B', 'hex', 'usb');

    expect(reader.getState().usb).toMatchObject({ lastReadAt: 5_000, lastInvalidAt: 5_010 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

function nfcSetup() {
  const ports: { setStatus?: (status: NfcStatus) => void } = {};
  const start = vi.fn<NfcInputAdapter['start']>((given) => {
    ports.setStatus = given.setStatus;
  });
  const stop = vi.fn<NfcInputAdapter['stop']>();
  const restart = vi.fn<NfcInputAdapter['restart']>(() => Promise.resolve());
  const reader = createCardReader({ now: () => 0, adapters: [], nfc: { start, stop, restart } });
  return { reader, ports, start, stop, restart };
}

describe('createCardReader: Web NFC adapter (point 3)', () => {
  it('starts with activate(), stops with deactivate() and goes back to checking', () => {
    const { reader, ports, start, stop } = nfcSetup();
    expect(start).not.toHaveBeenCalled();

    reader.activate({ usbFormat: null });
    ports.setStatus?.('active');
    expect(start).toHaveBeenCalledTimes(1);
    expect(reader.getState().nfc).toBe('active');

    reader.deactivate();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(reader.getState().nfc).toBe('checking');
  });

  it('ignores a status reported while the service is not active', () => {
    const { reader, ports } = nfcSetup();
    reader.activate({ usbFormat: null });
    reader.deactivate();
    const listener = vi.fn<() => void>();
    reader.subscribe(listener);

    ports.setStatus?.('active');

    expect(reader.getState().nfc).toBe('checking');
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies only when the status changes', () => {
    const { reader, ports } = nfcSetup();
    reader.activate({ usbFormat: null });
    const listener = vi.fn<() => void>();
    reader.subscribe(listener);

    ports.setStatus?.('off');
    ports.setStatus?.('off');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('start() restarts the scan only while active', async () => {
    const { reader, restart } = nfcSetup();

    await reader.start();
    expect(restart).not.toHaveBeenCalled();

    reader.activate({ usbFormat: null });
    await reader.start();
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('start() without a Web NFC adapter resolves and does nothing', async () => {
    const { reader } = setup();
    reader.activate({ usbFormat: null });

    await expect(reader.start()).resolves.toBeUndefined();
  });
});

describe('createCardReader: exclusive write session (SPEC point 9)', () => {
  it('sends every read only to the session: no consumer, no vibration, no repeat window', () => {
    const { reader, card, vibrate, time } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);
    const onRead = vi.fn<(read: CardRead) => void>();

    reader.openWriteSession(onRead);
    card.read(UID);
    card.read(UID); // same uid at once: still delivered to the writer

    expect(onRead).toHaveBeenCalledTimes(2);
    // An adapter that reports no links (USB, E2E fake) hands the writer an empty list.
    expect(onRead).toHaveBeenLastCalledWith({ uid: UID, source: 'web-nfc', at: time() }, []);
    expect(consumer).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('after close gives the reads back to the consumer stack as it was', () => {
    const { reader, card, advance } = setup();
    reader.activate({ usbFormat: null });
    const below = vi.fn<CardConsumer>();
    const top = vi.fn<CardConsumer>();
    reader.pushConsumer(below);
    reader.pushConsumer(top);
    const onRead = vi.fn<(read: CardRead) => void>();

    const session = reader.openWriteSession(onRead);
    card.read(UID);
    session.close();
    advance(REPEAT_WINDOW_MS + 1);
    card.read(UID);

    expect(onRead).toHaveBeenCalledTimes(1);
    expect(top).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
  });

  it('a read during the session still counts for the repeat window after it', () => {
    const { reader, card, advance } = setup();
    reader.activate({ usbFormat: null });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    const session = reader.openWriteSession(() => {});
    card.read(UID);
    session.close();
    advance(500);
    card.read(UID); // the card just written, still on the phone: not a new read

    expect(consumer).not.toHaveBeenCalled();
  });

  it('reports no last read before any card was read', () => {
    const { reader } = setup();
    reader.activate({ usbFormat: null });

    expect(reader.openWriteSession(() => {}).lastRead).toBeNull();
  });

  it('lastRead is the latest valid read, even one dropped for lack of a consumer or by the repeat window', () => {
    const { reader, card, time, advance } = setup();
    reader.activate({ usbFormat: null });

    card.read(OTHER_UID);
    card.read(UID);
    advance(100);
    card.read(UID); // ignored by the repeat window, still the latest read
    card.read('zz'); // invalid: not a read

    const session = reader.openWriteSession(() => {});
    expect(session.lastRead).toEqual({ uid: UID, source: 'web-nfc', at: time() });
    session.close();
  });

  it('forgets the last read when deactivated', () => {
    const { reader, card } = setup();
    reader.activate({ usbFormat: null });
    card.read(UID);

    reader.deactivate();
    reader.activate({ usbFormat: null });

    expect(reader.openWriteSession(() => {}).lastRead).toBeNull();
  });

  it('refuses a second session while one is open; close is idempotent', () => {
    const { reader, card } = setup();
    reader.activate({ usbFormat: null });
    const first = reader.openWriteSession(() => {});

    expect(() => reader.openWriteSession(() => {})).toThrow(Error);

    first.close();
    const onRead = vi.fn<(read: CardRead) => void>();
    const second = reader.openWriteSession(onRead);
    first.close(); // a stale close does not end the newer session
    card.read(UID);

    expect(onRead).toHaveBeenCalledTimes(1);
    second.close();
  });

  it('start() during a session interrupts the writer before scanning again (SPEC point 9)', async () => {
    const { reader, restart } = nfcSetup();
    reader.activate({ usbFormat: null });
    const order: string[] = [];
    restart.mockImplementation(() => {
      order.push('restart');
      return Promise.resolve();
    });
    const session = reader.openWriteSession(() => {}, {
      onInterrupt: () => {
        order.push('interrupt');
        session.close();
      },
    });

    await reader.start();

    expect(order).toEqual(['interrupt', 'restart']);
  });

  it('start() with no session open interrupts nothing', async () => {
    const { reader, restart } = nfcSetup();
    reader.activate({ usbFormat: null });
    const onInterrupt = vi.fn<() => void>();
    reader.openWriteSession(() => {}, { onInterrupt }).close();

    await reader.start();

    expect(onInterrupt).not.toHaveBeenCalled();
    expect(restart).toHaveBeenCalledTimes(1);
  });
});

/** A writer target (`WebNfcApi` or the E2E fake) that can or cannot write. */
function writeTarget(supported: boolean) {
  return {
    isWriteSupported: () => supported,
    createWriter: vi.fn<CardWriteTarget['createWriter']>(() => ({
      write: () => Promise.resolve(),
    })),
  };
}

function writerSetup(options: { supported?: boolean } = {}) {
  const ports: { setStatus?: (status: NfcStatus) => void } = {};
  const nfc: NfcInputAdapter = {
    start: (given) => {
      ports.setStatus = given.setStatus;
    },
    stop: () => {},
    restart: () => Promise.resolve(),
  };
  const target = writeTarget(options.supported ?? true);
  const reader = createCardReader({ now: () => 0, adapters: [], nfc, writer: target });
  reader.activate({ usbFormat: null });
  return { reader, ports, target };
}

describe('createCardReader: canWrite (point 5, criterion 10)', () => {
  it('is true only with Web NFC active and a writer that can write', () => {
    const { reader, ports } = writerSetup();
    expect(reader.getState().canWrite).toBe(false);

    ports.setStatus?.('active');

    expect(reader.getState()).toMatchObject({ nfc: 'active', canWrite: true });
  });

  it.each<NfcStatus>(['off', 'denied', 'unsupported', 'needs-permission', 'starting', 'checking'])(
    'is false with the Web NFC status %s',
    (status) => {
      const { reader, ports } = writerSetup();
      ports.setStatus?.('active');

      ports.setStatus?.(status);

      expect(reader.getState()).toMatchObject({ nfc: status, canWrite: false });
    },
  );

  it('is false with Web NFC active but no write() (NDEFReader without write)', () => {
    const { reader, ports } = writerSetup({ supported: false });

    ports.setStatus?.('active');

    expect(reader.getState()).toMatchObject({ nfc: 'active', canWrite: false });
  });

  it('is false with no writer at all, even with Web NFC active', () => {
    const { reader, ports } = nfcSetup();
    reader.activate({ usbFormat: null });

    ports.setStatus?.('active');

    expect(reader.getState().canWrite).toBe(false);
  });

  it('is false with only the USB reader (tablet): the USB reader never writes', () => {
    const usb: UsbInputAdapter = {
      start: vi.fn<UsbInputAdapter['start']>(),
      stop: vi.fn<UsbInputAdapter['stop']>(),
    };
    const reader = createCardReader({ now: () => 0, adapters: [], usb, writer: writeTarget(true) });

    reader.activate({ usbFormat: 'dec' });

    expect(reader.getState()).toMatchObject({ usb: { enabled: true }, canWrite: false });
  });

  it('goes back to false and notifies when the service is deactivated', () => {
    const { reader, ports } = writerSetup();
    ports.setStatus?.('active');
    const listener = vi.fn<() => void>();
    reader.subscribe(listener);

    reader.deactivate();

    expect(reader.getState().canWrite).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('writeUrl refuses with cannot-write while canWrite is false, without creating a writer', async () => {
    const { reader, target } = writerSetup();

    await expect(
      reader.writeUrl('https://example.test/p/invented-token', { expectedUid: UID }),
    ).resolves.toEqual({ ok: false, reason: 'cannot-write' });
    expect(target.createWriter).not.toHaveBeenCalled();
  });

  it('writeUrl gets past the canWrite check once canWrite is true', async () => {
    const { reader, ports, target } = writerSetup();
    ports.setStatus?.('active');

    const result = reader.writeUrl('https://example.test/p/invented-token', {
      expectedUid: UID,
      signal: AbortSignal.abort(),
    });

    // Aborted before starting: the service's writer checked canWrite and the signal, nothing written.
    await expect(result).resolves.toEqual({ ok: false, reason: 'aborted' });
    expect(target.createWriter).not.toHaveBeenCalled();
  });
});

describe('createCardReader: inputs and writers that change (E2E fake, SPEC-card-input point 7)', () => {
  it('hands an input adapter an unreadable port that reaches only a running write session', () => {
    let unreadable: (() => void) | undefined;
    const adapter: CardInputAdapter = {
      start: (ports) => {
        unreadable = ports.unreadable;
      },
      stop: () => {},
    };
    const reader = createCardReader({ now: () => 0, adapters: [adapter] });
    reader.activate({ usbFormat: null });
    const onUnreadable = vi.fn<() => void>();

    unreadable?.();
    const session = reader.openWriteSession(() => {}, { onUnreadable });
    unreadable?.();
    session.close();
    unreadable?.();

    expect(onUnreadable).toHaveBeenCalledOnce();
  });

  it('recomputes canWrite and notifies when the writer says its write support changed', () => {
    let supported = true;
    const changeListeners = new Set<() => void>();
    const target: CardWriteTarget = {
      isWriteSupported: () => supported,
      createWriter: () => ({ write: () => Promise.resolve() }),
      subscribe: (listener) => {
        changeListeners.add(listener);
        return () => changeListeners.delete(listener);
      },
    };
    let setStatus: ((status: NfcStatus) => void) | undefined;
    const nfc: NfcInputAdapter = {
      start: (ports) => {
        setStatus = ports.setStatus;
      },
      stop: () => {},
      restart: () => Promise.resolve(),
    };
    const reader = createCardReader({ now: () => 0, adapters: [], nfc, writer: target });
    reader.activate({ usbFormat: null });
    setStatus?.('active');
    const listener = vi.fn<() => void>();
    reader.subscribe(listener);

    supported = false;
    for (const notify of changeListeners) notify();
    expect(reader.getState().canWrite).toBe(false);
    expect(listener).toHaveBeenCalledOnce();

    supported = true;
    for (const notify of changeListeners) notify();
    expect(reader.getState()).toMatchObject({ nfc: 'active', canWrite: true });

    // Still false whatever the writer says while Web NFC is not active.
    setStatus?.('off');
    for (const notify of changeListeners) notify();
    expect(reader.getState().canWrite).toBe(false);
  });
});
