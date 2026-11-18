import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCardReader, type CardRead, type DeliverRaw } from './cardReader';
import {
  EMPTY_WEDGE,
  MAX_KEY_GAP_MS,
  createKeyboardWedge,
  stepWedge,
  type WedgeKey,
} from './keyboardWedge';

// SPEC-card-input, point 4; success criterion 6. Invented uids only.

const UID = '04A1B2C3D4E5F6';
const UID_DEC = '1303689068602870';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

/** Every reader made by a test, deactivated afterwards so no listener stays on `document`. */
const readers: ReturnType<typeof createCardReader>[] = [];

afterEach(() => {
  for (const reader of readers.splice(0)) reader.deactivate();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function setup(
  usbFormat: Parameters<ReturnType<typeof createCardReader>['setUsbFormat']>[0] = 'hex',
) {
  const target = document;
  const addSpy = vi.spyOn(target, 'addEventListener');
  const removeSpy = vi.spyOn(target, 'removeEventListener');
  const usb = createKeyboardWedge({ target, now: () => Date.now() });
  const vibrate = vi.fn<(ms: number) => void>();
  const reader = createCardReader({ now: () => Date.now(), vibrate, adapters: [], usb });
  readers.push(reader);
  const consumer = vi.fn<(read: CardRead) => void>();
  reader.pushConsumer(consumer);
  reader.activate({ usbFormat });
  const keydownListeners = () =>
    addSpy.mock.calls.filter(([type]) => type === 'keydown').length -
    removeSpy.mock.calls.filter(([type]) => type === 'keydown').length;
  return { reader, consumer, vibrate, keydownListeners };
}

type KeyOptions = Partial<Pick<KeyboardEventInit, 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'>>;

function press(key: string, target: EventTarget = document.body, options: KeyOptions = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: /^[A-Z]$/.test(key),
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

/** Types `text` like a keyboard-wedge reader: one key every `gap` ms, then Enter. */
function burst(
  text: string,
  {
    gap = 5,
    target = document.body,
    shift = false,
  }: { gap?: number; target?: EventTarget; shift?: boolean } = {},
) {
  for (const char of text) {
    if (shift && /^[A-Z]$/.test(char)) press('Shift', target);
    press(char, target);
    vi.advanceTimersByTime(gap);
  }
  return press('Enter', target);
}

describe('keyboardWedge: bursts (criterion 6)', () => {
  it('delivers a fast burst closed by Enter and stops the Enter', () => {
    const { consumer, vibrate } = setup('hex');
    const button = document.createElement('button');
    document.body.append(button);
    const onButtonKey = vi.fn<(event: Event) => void>();
    button.addEventListener('keydown', onButtonKey);

    const enter = burst(UID, { target: button });

    expect(consumer).toHaveBeenCalledExactlyOnceWith<[CardRead]>({
      uid: UID,
      source: 'usb',
      at: Date.now(),
    });
    expect(vibrate).toHaveBeenCalledWith(80);
    expect(enter.defaultPrevented).toBe(true);
    expect(onButtonKey).toHaveBeenCalledTimes(UID.length); // the characters, not the Enter
  });

  it('reads upper-case letters sent with Shift between the characters', () => {
    const { consumer } = setup('hex');

    burst(UID, { shift: true });

    expect(consumer.mock.calls.map(([read]) => read.uid)).toEqual([UID]);
  });

  it('reads with the configured format (dec)', () => {
    const { consumer } = setup('dec');

    burst(UID_DEC);

    expect(consumer.mock.calls.map(([read]) => read.uid)).toEqual([UID]);
  });

  it('accepts a gap of exactly 50 ms', () => {
    const { consumer } = setup('hex');

    burst(UID, { gap: MAX_KEY_GAP_MS });

    expect(consumer).toHaveBeenCalledTimes(1);
  });

  it('reads nothing when the keys are more than 50 ms apart, and lets the Enter through', () => {
    const { consumer } = setup('hex');

    const enter = burst(UID, { gap: MAX_KEY_GAP_MS + 1 });

    expect(consumer).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
  });

  it('reads nothing when Enter comes more than 50 ms after the last character', () => {
    const { consumer } = setup('hex');
    for (const char of UID) {
      press(char);
      vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(MAX_KEY_GAP_MS);

    const enter = press('Enter');

    expect(consumer).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
  });

  it('needs at least 4 characters', () => {
    const { consumer, reader } = setup('hex');

    const enter = burst('04A');

    expect(consumer).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    expect(reader.getState().usb.lastInvalidAt).toBeNull();
  });

  it('a key with Ctrl resets the buffer', () => {
    const { consumer } = setup('hex');
    for (const char of '04A1B2C') press(char);
    press('c', document.body, { ctrlKey: true });
    for (const char of '3D4') press(char);

    const enter = press('Enter');

    expect(consumer).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
  });

  it.each(['altKey', 'metaKey'] as const)('a key with %s resets the buffer', (modifier) => {
    const { consumer } = setup('hex');
    for (const char of '04A1B2C3') press(char);
    press('d', document.body, { [modifier]: true });
    for (const char of '04') press(char);

    press('Enter');

    expect(consumer).not.toHaveBeenCalled();
  });

  it('a repeated key resets the buffer', () => {
    const { consumer } = setup('hex');
    for (const char of '04A1B2C3') press(char);
    press('3', document.body, { repeat: true });
    for (const char of 'D4E') press(char);

    press('Enter');

    expect(consumer).not.toHaveBeenCalled();
  });

  it('a key the format does not allow resets the buffer: dec refuses letters', () => {
    const { consumer, reader } = setup('dec');

    const enter = burst(UID);

    expect(consumer).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    expect(reader.getState().usb.lastInvalidAt).toBeNull();
  });

  it('a burst after a reset still reads', () => {
    const { consumer } = setup('hex');
    press('x');
    press('Tab');

    burst(UID);

    expect(consumer).toHaveBeenCalledTimes(1);
  });
});

describe('keyboardWedge: editable targets', () => {
  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable',
      () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'true');
        return div;
      },
    ],
    [
      'inside contenteditable',
      () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', '');
        const span = document.createElement('span');
        div.append(span);
        document.body.append(div);
        return span;
      },
    ],
  ])('reads nothing from %s and does not stop the Enter', (_name, make) => {
    const { consumer } = setup('hex');
    const field = make();
    if (!field.isConnected) document.body.append(field);

    const enter = burst(UID, { target: field });

    expect(consumer).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
  });

  it('reads from an element with contenteditable="false"', () => {
    const { consumer } = setup('hex');
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'false');
    document.body.append(div);

    burst(UID, { target: div });

    expect(consumer).toHaveBeenCalledTimes(1);
  });
});

describe('keyboardWedge: lastReadAt and lastInvalidAt', () => {
  it('records lastReadAt on a valid read', () => {
    const { reader } = setup('hex');
    expect(reader.getState().usb.lastReadAt).toBeNull();

    burst(UID);

    expect(reader.getState().usb.lastReadAt).toBe(Date.now());
    expect(reader.getState().usb.lastInvalidAt).toBeNull();
  });

  it('records lastReadAt also for a repeat and without consumers (the reader is there)', () => {
    const { reader, consumer } = setup('hex');
    burst(UID);
    vi.advanceTimersByTime(500);

    burst(UID);

    expect(consumer).toHaveBeenCalledTimes(1);
    expect(reader.getState().usb.lastReadAt).toBe(Date.now());
  });

  it('an invalid read sets lastInvalidAt, delivers nothing and still stops the Enter', () => {
    const { reader, consumer, vibrate } = setup('hex');
    const listener = vi.fn<() => void>();
    reader.subscribe(listener);

    const enter = burst('04A1B'); // odd number of hex digits

    expect(consumer).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(true);
    expect(reader.getState().usb.lastInvalidAt).toBe(Date.now());
    expect(reader.getState().usb.lastReadAt).toBeNull();
    expect(listener).toHaveBeenCalled();
  });

  it('a read from another source does not touch the usb fields', () => {
    const ports: { deliver: DeliverRaw | null } = { deliver: null };
    const reader = createCardReader({
      now: () => Date.now(),
      adapters: [
        {
          start: ({ deliver }) => {
            ports.deliver = deliver;
          },
          stop: () => undefined,
        },
      ],
    });
    reader.activate({ usbFormat: null });

    ports.deliver?.(UID, 'hex', 'web-nfc');
    ports.deliver?.('nope', 'hex', 'web-nfc');

    expect(reader.getState().usb.lastReadAt).toBeNull();
    expect(reader.getState().usb.lastInvalidAt).toBeNull();
  });
});

describe('keyboardWedge: switched by the format', () => {
  it('has no listener while the format is null, and reads nothing', () => {
    const { consumer, keydownListeners, reader } = setup(null);

    const enter = burst(UID);

    expect(keydownListeners()).toBe(0);
    expect(consumer).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    expect(reader.getState().usb.enabled).toBe(false);
  });

  it('turns on when the format arrives', () => {
    const { consumer, keydownListeners, reader } = setup(null);

    reader.setUsbFormat('hex');
    burst(UID);

    expect(keydownListeners()).toBe(1);
    expect(reader.getState().usb).toMatchObject({ enabled: true, format: 'hex' });
    expect(consumer).toHaveBeenCalledTimes(1);
  });

  it('turns off again when the format goes back to null', () => {
    const { consumer, keydownListeners, reader } = setup('hex');

    reader.setUsbFormat(null);
    burst(UID);

    expect(keydownListeners()).toBe(0);
    expect(consumer).not.toHaveBeenCalled();
  });

  it('a format change applies from the next read, without a second listener', () => {
    const { consumer, keydownListeners, reader } = setup('hex');
    burst(UID);

    reader.setUsbFormat('dec');
    vi.advanceTimersByTime(3000);
    burst(UID_DEC);
    vi.advanceTimersByTime(3000);
    burst('04112233'); // digits only: now read as the decimal 4112233

    expect(keydownListeners()).toBe(1);
    expect(consumer.mock.calls.map(([read]) => read.uid)).toEqual([UID, UID, '003EBF69']);
  });

  it('deactivate() removes the listener', () => {
    const { consumer, keydownListeners, reader } = setup('hex');

    reader.deactivate();
    const enter = burst(UID);

    expect(keydownListeners()).toBe(0);
    expect(consumer).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    expect(reader.getState().usb.enabled).toBe(false);
  });

  it('listens in the capture phase', () => {
    const target = document;
    const addSpy = vi.spyOn(target, 'addEventListener');
    const usb = createKeyboardWedge({ target, now: () => Date.now() });
    const reader = createCardReader({ now: () => Date.now(), adapters: [], usb });

    reader.activate({ usbFormat: 'hex' });

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
    reader.deactivate();
  });

  it('activate() with a format starts it once, even when called again', () => {
    const { keydownListeners, reader } = setup('hex');

    reader.activate({ usbFormat: 'hex' });
    reader.activate({ usbFormat: 'dec' });

    expect(keydownListeners()).toBe(1);
  });
});

const key = (k: string, extra: Partial<WedgeKey> = {}): WedgeKey => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
  editable: false,
  ...extra,
});

describe('stepWedge (pure state)', () => {
  it('accumulates and returns the buffer on Enter', () => {
    let state = EMPTY_WEDGE;
    for (const [i, char] of ['0', '4', 'A', '1'].entries()) {
      state = stepWedge(state, key(char), i * 10, 'hex').state;
    }
    const result = stepWedge(state, key('Enter'), 40, 'hex');

    expect(result).toEqual({ state: EMPTY_WEDGE, raw: '04A1' });
  });

  it('restarts the buffer with the current character after a long gap', () => {
    const state = stepWedge({ buffer: '04A1', lastKeyAt: 0 }, key('B'), 51, 'hex').state;

    expect(state).toEqual({ buffer: 'B', lastKeyAt: 51 });
  });

  it('ignores Shift and CapsLock without resetting nor moving the clock', () => {
    const start = { buffer: '04A', lastKeyAt: 10 };

    expect(stepWedge(start, key('Shift'), 20, 'hex').state).toBe(start);
    expect(stepWedge(start, key('CapsLock'), 20, 'hex').state).toBe(start);
  });

  it('resets on an editable target', () => {
    const result = stepWedge(
      { buffer: '04A1', lastKeyAt: 0 },
      key('Enter', { editable: true }),
      5,
      'hex',
    );

    expect(result).toEqual({ state: EMPTY_WEDGE, raw: null });
  });

  it('never throws on keys it does not know', () => {
    expect(stepWedge(EMPTY_WEDGE, key('Unidentified'), 0, 'hex')).toEqual({
      state: EMPTY_WEDGE,
      raw: null,
    });
    expect(stepWedge(EMPTY_WEDGE, key('5'), 0, 'mystery').state).toEqual(EMPTY_WEDGE);
  });
});
