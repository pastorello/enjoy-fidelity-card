import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWebNfc, type FakeWriteOutcome } from '../../test/fakeWebNfc';
import {
  REPEAT_WINDOW_MS,
  createCardReader,
  type CardConsumer,
  type DeliverRaw,
} from './cardReader';
import { createWebNfcAdapter } from './webNfcAdapter';
import {
  IN_FIELD_MS,
  MAX_URL_LENGTH,
  VERIFY_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  createWebNfcWriter,
  type CardWriteResult,
  type CardWriteStep,
} from './webNfcWriter';

// SPEC-card-input, point 9; success criterion 10 (writing part of task 9). Invented uids and
// invented links only: a real link carries a customer's token.

const UID = '04A1B2C3D4E5F6';
const OTHER_UID = '04112233445566';
const URL = 'https://example.test/p/invented-token';

/** Lets the pending promises (permission query, scan, write) settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function setup(options: { canWrite?: boolean; writeOutcomes?: FakeWriteOutcome[] } = {}) {
  let time = 1_000_000;
  const canWrite = options.canWrite ?? true;
  const nfc = createFakeWebNfc({ permission: 'granted', writeOutcomes: options.writeOutcomes });
  const vibrate = vi.fn<(ms: number) => void>();
  // Stands for the USB keyboard wedge: a read typed by the cash-desk reader.
  let usbDeliver: DeliverRaw | null = null;
  const reader = createCardReader({
    now: () => time,
    vibrate,
    adapters: [
      {
        start: ({ deliver }) => {
          usbDeliver = deliver;
        },
        stop: () => {
          usbDeliver = null;
        },
      },
    ],
    nfc: createWebNfcAdapter(nfc.api),
  });
  reader.activate({ usbFormat: null });
  await settle();
  const writer = createWebNfcWriter({
    api: nfc.api,
    reader,
    now: () => time,
    canWrite: () => canWrite,
    vibrate,
  });
  return {
    nfc,
    reader,
    writer,
    vibrate,
    usbRead: (uid: string) => {
      usbDeliver?.(uid, 'hex', 'usb');
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

/** Starts a write and keeps track of its steps and result without awaiting it. */
function track(promise: Promise<CardWriteResult>) {
  const outcome: { result: CardWriteResult | null } = { result: null };
  void promise.then((result) => {
    outcome.result = result;
  });
  return outcome;
}

describe('createWebNfcWriter: the right card on the phone (criterion 10)', () => {
  it('a card read less than IN_FIELD_MS ago is written at once, with one url record and overwrite', async () => {
    const { nfc, writer, advance } = await setup();
    nfc.read(UID);
    advance(IN_FIELD_MS - 1);
    const steps: CardWriteStep[] = [];

    void writer.writeUrl(URL, { expectedUid: UID, onStep: (step) => steps.push(step) });
    await settle();

    expect(nfc.writes).toHaveLength(1);
    const [write] = nfc.writes;
    expect(write?.message).toEqual({ records: [{ recordType: 'url', data: URL }] });
    expect(write?.options.overwrite).toBe(true);
    expect(write?.options.signal).toBeInstanceOf(AbortSignal);
    expect(steps).toEqual(['waiting-card', 'writing', 'verifying']);
    expect(nfc.makeReadOnlyCalls()).toBe(0);
  });

  it('accepts the expected uid in the Web NFC spelling', async () => {
    const { nfc, writer } = await setup();
    nfc.read(UID);

    void writer.writeUrl(URL, { expectedUid: '04:a1:b2:c3:d4:e5:f6' });
    await settle();

    expect(nfc.writes).toHaveLength(1);
  });

  it('a read IN_FIELD_MS old or more waits for the card, then writes when it is read', async () => {
    const { nfc, writer, advance } = await setup();
    nfc.read(UID);
    advance(IN_FIELD_MS);
    const steps: CardWriteStep[] = [];

    void writer.writeUrl(URL, { expectedUid: UID, onStep: (step) => steps.push(step) });
    await settle();

    expect(nfc.writes).toHaveLength(0);
    expect(steps).toEqual(['waiting-card']);

    nfc.read(UID);
    await settle();

    expect(nfc.writes).toHaveLength(1);
    expect(steps).toEqual(['waiting-card', 'writing', 'verifying']);
  });

  it('with no read at all waits for the card', async () => {
    const { nfc, writer } = await setup();

    void writer.writeUrl(URL, { expectedUid: UID });
    await settle();

    expect(nfc.writes).toHaveLength(0);
  });

  it('another uid read after the expected one makes it wait, even within IN_FIELD_MS', async () => {
    const { nfc, writer, advance } = await setup();
    nfc.read(UID);
    advance(100);
    nfc.read(OTHER_UID);

    void writer.writeUrl(URL, { expectedUid: UID });
    await settle();

    expect(nfc.writes).toHaveLength(0);
  });

  it('another uid read while waiting ends with wrong-card and nothing written', async () => {
    const { nfc, writer } = await setup();
    const result = writer.writeUrl(URL, { expectedUid: UID });
    await settle();

    nfc.read(OTHER_UID);

    await expect(result).resolves.toEqual({ ok: false, reason: 'wrong-card', otherUid: OTHER_UID });
    expect(nfc.writes).toHaveLength(0);
    expect(nfc.makeReadOnlyCalls()).toBe(0);
  });

  it('a card read by the USB reader is not a card on the phone: never written, never wrong-card', async () => {
    const { nfc, writer, usbRead } = await setup();
    usbRead(UID);
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID }));
    await settle();

    usbRead(OTHER_UID);
    usbRead(UID);
    await settle();

    expect(nfc.writes).toHaveLength(0);
    expect(outcome.result).toBeNull();

    nfc.read(UID);
    await settle();
    expect(nfc.writes).toHaveLength(1);
  });
});

describe('createWebNfcWriter: outcomes of write()', () => {
  it.each([
    ['NotAllowedError', 'not-allowed'],
    ['NetworkError', 'io'],
    ['NotReadableError', 'io'],
    ['NotSupportedError', 'io'],
  ] as const)('%s → %s', async (error, reason) => {
    const { nfc, writer } = await setup({ writeOutcomes: [error] });
    nfc.read(UID);

    await expect(writer.writeUrl(URL, { expectedUid: UID })).resolves.toEqual({
      ok: false,
      reason,
    });
    expect(nfc.writes).toHaveLength(1);
  });

  it("the caller's signal while waiting for the card → aborted, nothing written", async () => {
    const { nfc, writer } = await setup();
    const controller = new AbortController();
    const result = writer.writeUrl(URL, { expectedUid: UID, signal: controller.signal });
    await settle();

    controller.abort();

    await expect(result).resolves.toEqual({ ok: false, reason: 'aborted' });
    nfc.read(UID);
    await settle();
    expect(nfc.writes).toHaveLength(0);
  });

  it("the caller's signal during write() → aborted, and the write is aborted too", async () => {
    const { nfc, writer } = await setup({ writeOutcomes: ['pending'] });
    nfc.read(UID);
    const controller = new AbortController();
    const result = writer.writeUrl(URL, { expectedUid: UID, signal: controller.signal });
    await settle();

    controller.abort();

    await expect(result).resolves.toEqual({ ok: false, reason: 'aborted' });
    expect(nfc.writes[0]?.options.signal.aborted).toBe(true);
  });

  it("the caller's signal during the verification → aborted, no vibration, no further write()", async () => {
    const { nfc, writer, vibrate } = await setup();
    nfc.read(UID);
    const controller = new AbortController();
    const steps: CardWriteStep[] = [];
    const result = writer.writeUrl(URL, {
      expectedUid: UID,
      signal: controller.signal,
      onStep: (step) => steps.push(step),
    });
    await settle();
    expect(steps.at(-1)).toBe('verifying');

    controller.abort();

    await expect(result).resolves.toEqual({ ok: false, reason: 'aborted' });
    nfc.read(UID, { urls: [URL] }); // the card read back after the abort changes nothing
    await settle();
    expect(nfc.writes).toHaveLength(1);
    expect(nfc.writes[0]?.options.signal.aborted).toBe(true);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('a signal already aborted → aborted without write()', async () => {
    const { nfc, writer } = await setup();
    nfc.read(UID);

    await expect(
      writer.writeUrl(URL, { expectedUid: UID, signal: AbortSignal.abort() }),
    ).resolves.toEqual({ ok: false, reason: 'aborted' });
    expect(nfc.writes).toHaveLength(0);
  });
});

describe('createWebNfcWriter: preconditions', () => {
  it('canWrite false → cannot-write, without write() and without taking the reads', async () => {
    const { nfc, reader, writer } = await setup({ canWrite: false });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    await expect(writer.writeUrl(URL, { expectedUid: UID })).resolves.toEqual({
      ok: false,
      reason: 'cannot-write',
    });
    nfc.read(UID);
    await settle();

    expect(nfc.writes).toHaveLength(0);
    expect(consumer).toHaveBeenCalledTimes(1);
  });

  it('a second write while one is running → busy; the first one goes on', async () => {
    const { nfc, writer } = await setup();
    const first = track(writer.writeUrl(URL, { expectedUid: UID }));
    await settle();

    await expect(writer.writeUrl(URL, { expectedUid: UID })).resolves.toEqual({
      ok: false,
      reason: 'busy',
    });

    nfc.read(OTHER_UID);
    await settle();
    expect(first.result).toEqual({ ok: false, reason: 'wrong-card', otherUid: OTHER_UID });
  });

  it('once a write has ended, a new one can start', async () => {
    const { nfc, writer } = await setup({ writeOutcomes: ['NetworkError'] });
    nfc.read(UID);
    await writer.writeUrl(URL, { expectedUid: UID });

    void writer.writeUrl(URL, { expectedUid: UID });
    await settle();

    expect(nfc.writes).toHaveLength(2);
  });

  it.each([
    ['http:', 'http://example.test/p/invented-token'],
    ['relative', '/p/invented-token'],
    ['not a url', 'invented-token'],
    ['surrounded by spaces', ` ${URL} `],
    [`${MAX_URL_LENGTH + 1} characters`, `https://example.test/${'a'.repeat(MAX_URL_LENGTH - 20)}`],
  ])('url %s → TypeError, nothing started', async (_case, url) => {
    const { nfc, writer } = await setup();
    nfc.read(UID);
    const onStep = vi.fn<(step: CardWriteStep) => void>();

    await expect(writer.writeUrl(url, { expectedUid: UID, onStep })).rejects.toThrow(TypeError);
    expect(nfc.writes).toHaveLength(0);
    expect(onStep).not.toHaveBeenCalled();
  });

  it(`a url of exactly ${MAX_URL_LENGTH} characters is written`, async () => {
    const { nfc, writer } = await setup();
    nfc.read(UID);
    const url = `https://example.test/${'a'.repeat(MAX_URL_LENGTH - 21)}`;
    expect(url).toHaveLength(MAX_URL_LENGTH);

    void writer.writeUrl(url, { expectedUid: UID });
    await settle();

    expect(nfc.writes).toHaveLength(1);
  });

  it.each(['', '04:a1:b', 'not-a-uid', '00000000'])(
    'expectedUid %j → TypeError',
    async (expectedUid) => {
      const { writer } = await setup();

      await expect(writer.writeUrl(URL, { expectedUid })).rejects.toThrow(TypeError);
    },
  );
});

describe('createWebNfcWriter: exclusive session', () => {
  it('during the write consumers get no reads; at the end they do, with the stack as before', async () => {
    const { nfc, reader, writer, vibrate, advance } = await setup();
    const below = vi.fn<CardConsumer>();
    const top = vi.fn<CardConsumer>();
    reader.pushConsumer(below);
    reader.pushConsumer(top);
    const controller = new AbortController();
    const result = writer.writeUrl(URL, { expectedUid: UID, signal: controller.signal });
    await settle();

    nfc.read(UID); // the expected card: written, then verification starts
    await settle();
    advance(REPEAT_WINDOW_MS + 1);
    nfc.read(OTHER_UID); // another card, during the verification: it stays with the writer
    await settle();

    expect(top).not.toHaveBeenCalled();
    expect(below).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();

    controller.abort();
    await expect(result).resolves.toEqual({ ok: false, reason: 'aborted' });
    advance(REPEAT_WINDOW_MS + 1);
    nfc.read(UID);

    expect(top).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
  });

  it('gives the reads back after a failure too', async () => {
    const { nfc, reader, writer, advance } = await setup();
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    const result = writer.writeUrl(URL, { expectedUid: UID });
    await settle();
    nfc.read(OTHER_UID);
    await result;
    advance(REPEAT_WINDOW_MS + 1);
    nfc.read(OTHER_UID);

    expect(consumer).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A write whose card was read a moment ago: write() runs at once and resolves (step `verifying`). */
async function writtenAndVerifying(options: Parameters<typeof setup>[0] = {}) {
  const context = await setup(options);
  context.nfc.read(UID);
  const steps: CardWriteStep[] = [];
  const outcome = track(
    context.writer.writeUrl(URL, { expectedUid: UID, onStep: (step) => steps.push(step) }),
  );
  await settle();
  context.vibrate.mockClear(); // the read above reached no consumer, but stay explicit
  return { ...context, steps, outcome };
}

describe('createWebNfcWriter: verification by reading the card back (criterion 10)', () => {
  it('ok only once a read of the expected card reports exactly the url; then it vibrates', async () => {
    const { nfc, steps, outcome, vibrate } = await writtenAndVerifying();
    expect(steps).toEqual(['waiting-card', 'writing', 'verifying']);
    expect(outcome.result).toBeNull(); // write() resolved: not yet a success

    nfc.read(UID, { texts: ['invented text'], urls: [URL] });
    await settle();

    expect(outcome.result).toEqual({ ok: true });
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(80);
    expect(nfc.makeReadOnlyCalls()).toBe(0);
  });

  it('the expected card with another url → verify-failed, no vibration', async () => {
    const { nfc, outcome, vibrate } = await writtenAndVerifying();

    nfc.read(UID, { urls: ['https://example.test/p/another-invented-token'] });
    await settle();

    expect(outcome.result).toEqual({ ok: false, reason: 'verify-failed' });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('the expected card with no url, or a url that only starts like it → verify-failed', async () => {
    const empty = await writtenAndVerifying();
    empty.nfc.read(UID);
    await settle();
    expect(empty.outcome.result).toEqual({ ok: false, reason: 'verify-failed' });

    const longer = await writtenAndVerifying();
    longer.nfc.read(UID, { urls: [`${URL}x`] });
    await settle();
    expect(longer.outcome.result).toEqual({ ok: false, reason: 'verify-failed' });
  });

  it('another card with the url during the verification → wrong-card with its uid', async () => {
    const { nfc, outcome } = await writtenAndVerifying();

    nfc.read(OTHER_UID, { urls: [URL] });
    await settle();

    expect(outcome.result).toEqual({ ok: false, reason: 'wrong-card', otherUid: OTHER_UID });
  });

  it('another card without the url during the verification is ignored', async () => {
    const { nfc, outcome } = await writtenAndVerifying();

    nfc.read(OTHER_UID, { urls: ['https://example.test/p/another-invented-token'] });
    nfc.read(OTHER_UID);
    await settle();
    expect(outcome.result).toBeNull();

    nfc.read(UID, { urls: [URL] });
    await settle();
    expect(outcome.result).toEqual({ ok: true });
  });

  it('readingerror during the verification is ignored', async () => {
    const { nfc, outcome } = await writtenAndVerifying();

    nfc.readError();
    await settle();
    expect(outcome.result).toBeNull();

    nfc.read(UID, { urls: [URL] });
    await settle();
    expect(outcome.result).toEqual({ ok: true });
  });

  it('a read of the expected card while write() is still running is not the verification', async () => {
    const { nfc, writer } = await setup({ writeOutcomes: ['pending'] });
    nfc.read(UID);
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID }));
    await settle();

    nfc.read(UID, { urls: [URL] });
    await settle();

    expect(outcome.result).toBeNull();
    expect(nfc.writes[0]?.options.signal.aborted).toBe(false);
  });
});

describe('createWebNfcWriter: card swapped during write()', () => {
  it('another uid while write() runs → abort() and wrong-card with its uid', async () => {
    const { nfc, writer } = await setup({ writeOutcomes: ['pending'] });
    nfc.read(UID);
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID }));
    await settle();

    nfc.read(OTHER_UID);
    await settle();

    expect(outcome.result).toEqual({ ok: false, reason: 'wrong-card', otherUid: OTHER_UID });
    expect(nfc.writes[0]?.options.signal.aborted).toBe(true);
  });
});

describe('createWebNfcWriter: unreadable card (readingerror)', () => {
  it('readingerror while waiting → unreadable, nothing written', async () => {
    const { nfc, writer } = await setup();
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID }));
    await settle();

    nfc.readError();
    await settle();

    expect(outcome.result).toEqual({ ok: false, reason: 'unreadable' });
    expect(nfc.writes).toHaveLength(0);
  });

  it('with allowUnreadable, readingerror counts as the expected card: written, then verified', async () => {
    const { nfc, writer } = await setup();
    const steps: CardWriteStep[] = [];
    const outcome = track(
      writer.writeUrl(URL, {
        expectedUid: UID,
        allowUnreadable: true,
        onStep: (step) => steps.push(step),
      }),
    );
    await settle();

    nfc.readError();
    await settle();

    expect(nfc.writes).toHaveLength(1);
    expect(nfc.writes[0]?.message).toEqual({ records: [{ recordType: 'url', data: URL }] });
    expect(steps).toEqual(['waiting-card', 'writing', 'verifying']);
    nfc.read(UID, { urls: [URL] });
    await settle();
    expect(outcome.result).toEqual({ ok: true });
  });

  it('with allowUnreadable another uid while waiting is still wrong-card', async () => {
    const { nfc, writer } = await setup();
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID, allowUnreadable: true }));
    await settle();

    nfc.read(OTHER_UID);
    await settle();

    expect(outcome.result).toEqual({ ok: false, reason: 'wrong-card', otherUid: OTHER_UID });
    expect(nfc.writes).toHaveLength(0);
  });

  it('readingerror while write() runs is ignored', async () => {
    const { nfc, writer } = await setup({ writeOutcomes: ['pending'] });
    nfc.read(UID);
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID }));
    await settle();

    nfc.readError();
    await settle();

    expect(outcome.result).toBeNull();
    expect(nfc.writes[0]?.options.signal.aborted).toBe(false);
  });
});

describe('createWebNfcWriter: time limits (criterion 10)', () => {
  it(`no card for ${WRITE_TIMEOUT_MS} ms → timeout, nothing written`, async () => {
    const { nfc, writer } = await setup();
    vi.useFakeTimers();
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID }));

    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - 1);
    expect(outcome.result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(outcome.result).toEqual({ ok: false, reason: 'timeout' });
    expect(nfc.writes).toHaveLength(0);
  });

  it(`write() still running after ${WRITE_TIMEOUT_MS} ms in all → abort() and timeout`, async () => {
    const { nfc, writer } = await setup({ writeOutcomes: ['pending'] });
    vi.useFakeTimers();
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID }));
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - 100);
    nfc.read(UID); // the card arrives late: write() starts, the clock keeps running
    await vi.advanceTimersByTimeAsync(0);
    expect(nfc.writes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);

    expect(outcome.result).toEqual({ ok: false, reason: 'timeout' });
    expect(nfc.writes[0]?.options.signal.aborted).toBe(true);
  });

  it(`no verification in ${VERIFY_TIMEOUT_MS} ms → timeout and abort()`, async () => {
    const { nfc, writer, vibrate } = await setup();
    nfc.read(UID);
    vi.useFakeTimers();
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID }));
    await vi.advanceTimersByTimeAsync(VERIFY_TIMEOUT_MS - 1);
    expect(outcome.result).toBeNull();

    await vi.advanceTimersByTimeAsync(1);

    expect(outcome.result).toEqual({ ok: false, reason: 'timeout' });
    expect(nfc.writes[0]?.options.signal.aborted).toBe(true);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('the verification gets its own full time, counted from write() resolving', async () => {
    const { nfc, writer } = await setup();
    vi.useFakeTimers();
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID }));
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - 100);
    nfc.read(UID);
    await vi.advanceTimersByTimeAsync(VERIFY_TIMEOUT_MS - 1);
    expect(outcome.result).toBeNull();

    nfc.read(UID, { urls: [URL] });
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome.result).toEqual({ ok: true });
  });

  it('after an outcome no timer is left running', async () => {
    const { nfc, writer } = await setup();
    vi.useFakeTimers();
    const result = writer.writeUrl(URL, { expectedUid: UID });
    nfc.read(OTHER_UID);
    await expect(result).resolves.toMatchObject({ reason: 'wrong-card' });

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createWebNfcWriter: start() during a write', () => {
  it.each([
    ['waiting for the card', [] as FakeWriteOutcome[], false],
    ['during write()', ['pending'] as FakeWriteOutcome[], true],
    ['during the verification', [] as FakeWriteOutcome[], true],
  ])('%s → aborted, and the scan starts again', async (_case, writeOutcomes, cardOnPhone) => {
    const { nfc, reader, writer } = await setup({ writeOutcomes });
    if (cardOnPhone) nfc.read(UID);
    const outcome = track(writer.writeUrl(URL, { expectedUid: UID }));
    await settle();
    const scans = nfc.scanCount();

    await reader.start();
    await settle();

    expect(outcome.result).toEqual({ ok: false, reason: 'aborted' });
    expect(nfc.scanCount()).toBe(scans + 1);
    for (const write of nfc.writes) expect(write.options.signal.aborted).toBe(true);
  });
});

describe('createWebNfcWriter: the links stay with the writer', () => {
  it('no link in a consumer read and nothing in the console, through a whole write', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const { nfc, reader, writer, advance } = await setup();
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);
    nfc.read(UID, { urls: [URL] }); // before: a card that already holds the link
    advance(100);

    const result = writer.writeUrl(URL, { expectedUid: UID });
    await settle();
    nfc.readError();
    nfc.read(OTHER_UID, { urls: ['https://example.test/p/another-invented-token'] });
    nfc.read(UID, { urls: [URL] });
    await expect(result).resolves.toEqual({ ok: true });
    advance(REPEAT_WINDOW_MS + 1);
    nfc.readError();
    nfc.read(UID, { urls: [URL] }); // after: back to the consumer, uid only

    expect(consumer).toHaveBeenCalledTimes(2);
    for (const call of consumer.mock.calls) {
      expect(call).toHaveLength(1);
      expect(Object.keys(call[0]).toSorted()).toEqual(['at', 'source', 'uid']);
      expect(JSON.stringify(call[0])).not.toContain('example.test');
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
