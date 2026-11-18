import { describe, expect, it, vi } from 'vitest';
import {
  REPEAT_WINDOW_MS,
  createCardReader,
  type CardConsumer,
  type CardInputAdapter,
  type CardRead,
  type CardReaderOptions,
  type DeliverRaw,
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
