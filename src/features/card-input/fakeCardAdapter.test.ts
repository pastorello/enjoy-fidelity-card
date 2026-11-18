import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCardReader,
  REPEAT_WINDOW_MS,
  type CardRead,
  type NfcInputAdapter,
  type NfcStatus,
} from './cardReader';
import { createFakeCard, type FakeCardHost } from './fakeCardAdapter';
import { IN_FIELD_MS, WRITE_TIMEOUT_MS, type CardWriteStep } from './webNfcWriter';

// SPEC-card-input, point 7: the E2E fake reader and writer. Invented uids and links only.

const UID = '04A1B2C3D4E5F6';
const OTHER_UID = '04112233445566';
const URL_A = 'https://example.test/p/invented-token-a';
const URL_B = 'https://example.test/p/invented-token-b';

function setup() {
  let clock = 1_000;
  const now = () => clock;
  const host: FakeCardHost = {};
  const vibrate = vi.fn<(ms: number) => unknown>();
  const fake = createFakeCard(host, { now });
  // The Web NFC status the fake writer needs to write (in E2E it comes from stubWebNfc).
  const ports: { setStatus?: (status: NfcStatus) => void } = {};
  const nfc: NfcInputAdapter = {
    start: (given) => {
      ports.setStatus = given.setStatus;
    },
    stop: () => {},
    restart: () => Promise.resolve(),
  };
  const reader = createCardReader({
    now,
    vibrate,
    adapters: [fake.adapter],
    nfc,
    writer: fake.writer,
  });
  const onRead = vi.fn<(read: CardRead) => void>();
  reader.pushConsumer(onRead);
  const tap = (uid: string) => {
    if (!host.__enjoyFakeCard) throw new Error('__enjoyFakeCard not installed');
    host.__enjoyFakeCard(uid);
  };
  const control = () => {
    if (!host.__enjoyFakeCardControl) throw new Error('__enjoyFakeCardControl not installed');
    return host.__enjoyFakeCardControl;
  };
  return {
    host,
    reader,
    onRead,
    vibrate,
    tap,
    control,
    writes: () => host.__enjoyFakeCardWrites ?? [],
    /** Activates the service with Web NFC active, as on a phone that can write. */
    activateWriting: () => {
      reader.activate({ usbFormat: null });
      ports.setStatus?.('active');
    },
    setNfcStatus: (status: NfcStatus) => ports.setStatus?.(status),
    advance: (ms: number) => {
      clock += ms;
    },
    /** The links the card holds, as a running write would see them on the next tap. */
    linksOn: (uid: string): readonly string[] | 'unreadable' => {
      let seen: readonly string[] | 'unreadable' = 'unreadable';
      const session = reader.openWriteSession((_read, urls) => {
        seen = urls;
      });
      tap(uid);
      session.close();
      return seen;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createFakeCard: reads', () => {
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

  it('a blank tag holds no links', () => {
    const { activateWriting, linksOn } = setup();
    activateWriting();
    expect(linksOn(UID)).toEqual([]);
  });
});

describe('createFakeCard: writes (E2E fake writer)', () => {
  it('installs an empty __enjoyFakeCardWrites log and __enjoyFakeCardControl', () => {
    const { host } = setup();
    expect(host.__enjoyFakeCardWrites).toEqual([]);
    expect(typeof host.__enjoyFakeCardControl?.failNextWrite).toBe('function');
    expect(typeof host.__enjoyFakeCardControl?.setCanWrite).toBe('function');
  });

  it('can write once Web NFC is active (canWrite true)', () => {
    const { reader, activateWriting } = setup();
    activateWriting();
    expect(reader.getState().canWrite).toBe(true);
  });

  it('writes on the card just read and verifies it without another tap: ok and one log entry', async () => {
    const { reader, onRead, tap, writes, advance, activateWriting, linksOn, vibrate } = setup();
    activateWriting();
    tap(UID);
    advance(IN_FIELD_MS - 1);
    const steps: CardWriteStep[] = [];

    const result = await reader.writeUrl(URL_A, {
      expectedUid: UID,
      onStep: (step) => steps.push(step),
    });

    expect(result).toEqual({ ok: true });
    expect(steps).toEqual(['waiting-card', 'writing', 'verifying']);
    expect(writes()).toEqual([{ uid: UID, url: URL_A, at: 1_000 + IN_FIELD_MS - 1 }]);
    expect(linksOn(UID)).toEqual([URL_A]);
    // The read back went to the writer only: the screen got the first tap and nothing else.
    expect(onRead).toHaveBeenCalledOnce();
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('with the card no longer on the phone, waits for a tap of it, then writes and verifies', async () => {
    const { reader, tap, writes, advance, activateWriting, linksOn } = setup();
    activateWriting();
    tap(UID);
    advance(IN_FIELD_MS);
    const steps: CardWriteStep[] = [];

    const result = reader.writeUrl(URL_A, {
      expectedUid: UID,
      onStep: (step) => steps.push(step),
    });
    expect(steps).toEqual(['waiting-card']);
    expect(writes()).toEqual([]);
    tap(UID);

    await expect(result).resolves.toEqual({ ok: true });
    expect(writes()).toEqual([{ uid: UID, url: URL_A, at: 1_000 + IN_FIELD_MS }]);
    expect(linksOn(UID)).toEqual([URL_A]);
  });

  it('a tap of another card while waiting: wrong-card and nothing written', async () => {
    const { reader, tap, writes, activateWriting, linksOn } = setup();
    activateWriting();

    const result = reader.writeUrl(URL_A, { expectedUid: UID });
    tap(OTHER_UID);

    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'wrong-card',
      otherUid: OTHER_UID,
    });
    expect(writes()).toEqual([]);
    expect(linksOn(OTHER_UID)).toEqual([]);
  });

  it('a new write replaces the link and is logged again', async () => {
    const { reader, tap, writes, advance, activateWriting, linksOn } = setup();
    activateWriting();
    tap(UID);
    await reader.writeUrl(URL_A, { expectedUid: UID });
    advance(IN_FIELD_MS);

    const result = reader.writeUrl(URL_B, { expectedUid: UID });
    tap(UID);

    await expect(result).resolves.toEqual({ ok: true });
    expect(writes().map((entry) => entry.url)).toEqual([URL_A, URL_B]);
    expect(linksOn(UID)).toEqual([URL_B]);
  });

  it("failNextWrite('not-allowed'): not-allowed, nothing written, and only the next write fails", async () => {
    const { reader, tap, writes, control, activateWriting, linksOn } = setup();
    activateWriting();
    tap(UID);
    control().failNextWrite('not-allowed');

    await expect(reader.writeUrl(URL_A, { expectedUid: UID })).resolves.toEqual({
      ok: false,
      reason: 'not-allowed',
    });
    expect(writes()).toEqual([]);
    expect(linksOn(UID)).toEqual([]);

    await expect(reader.writeUrl(URL_A, { expectedUid: UID })).resolves.toEqual({ ok: true });
    expect(writes()).toHaveLength(1);
  });

  it("failNextWrite('verify-failed'): the card reads back another content", async () => {
    const { reader, tap, writes, control, activateWriting } = setup();
    activateWriting();
    tap(UID);
    control().failNextWrite('verify-failed');

    await expect(reader.writeUrl(URL_A, { expectedUid: UID })).resolves.toEqual({
      ok: false,
      reason: 'verify-failed',
    });
    expect(writes()).toEqual([]);
  });

  it("failNextWrite('timeout'): the write never ends, timeout after the time limit", async () => {
    vi.useFakeTimers();
    const { reader, tap, writes, control, activateWriting } = setup();
    activateWriting();
    tap(UID);
    control().failNextWrite('timeout');

    const result = reader.writeUrl(URL_A, { expectedUid: UID });
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);

    await expect(result).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(writes()).toEqual([]);
  });

  it("failNextWrite('unreadable'): the next card tapped gives no uid, unreadable", async () => {
    const { reader, tap, onRead, writes, control, activateWriting } = setup();
    activateWriting();
    control().failNextWrite('unreadable');

    const result = reader.writeUrl(URL_A, { expectedUid: UID });
    tap(UID);

    await expect(result).resolves.toEqual({ ok: false, reason: 'unreadable' });
    expect(writes()).toEqual([]);
    expect(onRead).not.toHaveBeenCalled();

    // Only that tap: the card reads normally again.
    tap(UID);
    expect(onRead).toHaveBeenCalledOnce();
  });

  it("failNextWrite('io') leaves the card damaged: unreadable until rewritten with allowUnreadable", async () => {
    const { reader, tap, onRead, writes, control, advance, activateWriting, linksOn } = setup();
    activateWriting();
    tap(UID);
    control().failNextWrite('io');

    await expect(reader.writeUrl(URL_A, { expectedUid: UID })).resolves.toEqual({
      ok: false,
      reason: 'io',
    });
    expect(writes()).toEqual([]);
    expect(linksOn(UID)).toBe('unreadable');

    // A damaged card gives no uid: the screen gets nothing, a write gets unreadable.
    advance(REPEAT_WINDOW_MS + 1);
    tap(UID);
    expect(onRead).toHaveBeenCalledOnce();
    advance(IN_FIELD_MS);
    const refused = reader.writeUrl(URL_A, { expectedUid: UID });
    tap(UID);
    await expect(refused).resolves.toEqual({ ok: false, reason: 'unreadable' });

    // The operator confirms it is the right card: written and repaired.
    advance(IN_FIELD_MS);
    const repaired = reader.writeUrl(URL_A, { expectedUid: UID, allowUnreadable: true });
    tap(UID);
    await expect(repaired).resolves.toEqual({ ok: true });
    expect(writes()).toEqual([{ uid: UID, url: URL_A, at: expect.any(Number) }]);
    expect(linksOn(UID)).toEqual([URL_A]);
  });

  it('setCanWrite(false) makes canWrite false and writes refused; setCanWrite(true) restores it', async () => {
    const { reader, tap, writes, control, activateWriting } = setup();
    activateWriting();
    const listener = vi.fn<() => void>();
    reader.subscribe(listener);

    control().setCanWrite(false);
    expect(reader.getState()).toMatchObject({ nfc: 'active', canWrite: false });
    expect(listener).toHaveBeenCalled();
    tap(UID);
    await expect(reader.writeUrl(URL_A, { expectedUid: UID })).resolves.toEqual({
      ok: false,
      reason: 'cannot-write',
    });
    expect(writes()).toEqual([]);

    control().setCanWrite(true);
    expect(reader.getState().canWrite).toBe(true);
  });

  it('setCanWrite(true) cannot make canWrite true while Web NFC is not active', () => {
    const { reader, control, setNfcStatus } = setup();
    reader.activate({ usbFormat: null });
    setNfcStatus('unsupported');

    control().setCanWrite(true);

    expect(reader.getState().canWrite).toBe(false);
  });
});

describe('createFakeCard: write() with no card on the phone', () => {
  const message = { records: [{ recordType: 'url', data: URL_A }] };

  it('waits like Chrome and writes the next card put on the phone, whichever it is', async () => {
    const { host } = setup();
    const fake = createFakeCard(host, { now: () => 0 });
    const written = fake.writer
      .createWriter()
      .write(message, { overwrite: true, signal: new AbortController().signal });

    host.__enjoyFakeCard?.(OTHER_UID);

    await expect(written).resolves.toBeUndefined();
    expect(host.__enjoyFakeCardWrites).toEqual([{ uid: OTHER_UID, url: URL_A, at: 0 }]);
  });

  it('rejects with AbortError when its signal aborts, and the next card is not written', async () => {
    const { host } = setup();
    const fake = createFakeCard(host, { now: () => 0 });
    const control = new AbortController();
    const written = fake.writer.createWriter().write(message, {
      overwrite: true,
      signal: control.signal,
    });

    control.abort();
    host.__enjoyFakeCard?.(UID);

    await expect(written).rejects.toMatchObject({ name: 'AbortError' });
    expect(host.__enjoyFakeCardWrites).toEqual([]);
  });
});
