import { describe, expect, it, vi } from 'vitest';
import { createCardReader, REPEAT_WINDOW_MS, type CardRead } from './cardReader';
import { createFakeCardAdapter, type FakeCardHost } from './fakeCardAdapter';

// SPEC-card-input, point 7: the E2E fake reader. Invented uids only.

const UID = '04A1B2C3D4E5F6';

function setup() {
  let clock = 1_000;
  const host: FakeCardHost = {};
  const vibrate = vi.fn<(ms: number) => unknown>();
  const reader = createCardReader({
    now: () => clock,
    vibrate,
    adapters: [createFakeCardAdapter(host)],
  });
  const onRead = vi.fn<(read: CardRead) => void>();
  reader.pushConsumer(onRead);
  const tap = (uid: string) => {
    if (!host.__enjoyFakeCard) throw new Error('__enjoyFakeCard not installed');
    host.__enjoyFakeCard(uid);
  };
  return {
    host,
    reader,
    onRead,
    vibrate,
    tap,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('createFakeCardAdapter', () => {
  it('installs window.__enjoyFakeCard as a function', () => {
    const { host } = setup();
    expect(typeof host.__enjoyFakeCard).toBe('function');
  });

  it('reads nothing while the service is not active', () => {
    const { reader, onRead, vibrate, tap } = setup();
    tap(UID);
    expect(onRead).not.toHaveBeenCalled();

    reader.activate({ usbFormat: null });
    reader.deactivate();
    tap(UID);
    expect(onRead).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('delivers a normalized hex uid as a fake read, with the vibration', () => {
    const { reader, onRead, vibrate, tap } = setup();
    reader.activate({ usbFormat: null });

    tap('04:a1:b2:c3:d4:e5:f6');
    expect(onRead).toHaveBeenCalledWith({ uid: UID, source: 'fake', at: 1_000 });
    expect(vibrate).toHaveBeenCalledWith(80);
  });

  it('applies the same rules as the other inputs: repeats and invalid uids are dropped', () => {
    const { reader, onRead, tap, advance } = setup();
    reader.activate({ usbFormat: null });

    tap(UID);
    advance(REPEAT_WINDOW_MS - 1);
    tap(UID);
    expect(onRead).toHaveBeenCalledOnce();

    // The window runs from the last read, delivered or not.
    advance(REPEAT_WINDOW_MS + 1);
    tap(UID);
    expect(onRead).toHaveBeenCalledTimes(2);

    advance(REPEAT_WINDOW_MS + 1);
    tap('04:a1:b');
    tap('0g');
    expect(onRead).toHaveBeenCalledTimes(2);
  });

  it('reads whatever the Web NFC status (none here: the service reports it unchanged)', () => {
    const { reader, onRead, tap } = setup();
    reader.activate({ usbFormat: null });
    expect(reader.getState().nfc).not.toBe('active');

    tap(UID);
    expect(onRead).toHaveBeenCalledOnce();
  });
});
