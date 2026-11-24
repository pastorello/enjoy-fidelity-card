import { describe, expect, it, vi } from 'vitest';
import { createFakeWebNfc, type FakeScanOutcome } from '../../test/fakeWebNfc';
import { createCardReader, type CardConsumer, type WriteSessionConsumer } from './cardReader';
import {
  createBrowserWebNfcApi,
  createWebNfcAdapter,
  type BrowserNfcHost,
  type NfcPermission,
} from './webNfcAdapter';

// SPEC-card-input, point 3; success criteria 2, 3, 4 and 7. Invented uids only.

const UID = '04A1B2C3D4E5F6';

/** Lets the pending promises (permission query, scan) settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(
  options: {
    supported?: boolean;
    permission?: NfcPermission | null;
    scanOutcomes?: FakeScanOutcome[];
  } = {},
) {
  const nfc = createFakeWebNfc(options);
  const vibrate = vi.fn<(ms: number) => void>();
  const reader = createCardReader({
    now: () => 1_000_000,
    vibrate,
    adapters: [],
    nfc: createWebNfcAdapter(nfc.api),
  });
  return { nfc, reader, vibrate, status: () => reader.getState().nfc };
}

async function activated(options: Parameters<typeof setup>[0] = {}) {
  const context = setup(options);
  context.reader.activate({ usbFormat: null });
  await settle();
  return context;
}

describe('createWebNfcAdapter: start (criteria 2 and 4)', () => {
  it('with the permission granted starts scanning at once, without a tap', async () => {
    const { nfc, status } = await activated({ permission: 'granted' });

    expect(nfc.scanCount()).toBe(1);
    expect(status()).toBe('active');
  });

  it('with the permission to ask waits for a tap, then start() makes it active', async () => {
    const { nfc, reader, status } = await activated({ permission: 'prompt' });

    expect(status()).toBe('needs-permission');
    expect(nfc.scanCount()).toBe(0);

    await reader.start();

    expect(nfc.scanCount()).toBe(1);
    expect(status()).toBe('active');
  });

  it('without a permission query asks for a tap like prompt', async () => {
    const { nfc, status } = await activated({ permission: null });

    expect(status()).toBe('needs-permission');
    expect(nfc.scanCount()).toBe(0);
  });

  it('with the permission denied says denied and does not scan', async () => {
    const { nfc, status } = await activated({ permission: 'denied' });

    expect(status()).toBe('denied');
    expect(nfc.scanCount()).toBe(0);
  });

  it('without NDEFReader (iPhone) is unsupported and never scans, not even on start()', async () => {
    const { nfc, reader, status } = await activated({ supported: false });

    expect(status()).toBe('unsupported');
    await reader.start();
    expect(status()).toBe('unsupported');
    expect(nfc.scanCount()).toBe(0);
    expect(nfc.permissionQueries()).toBe(0);
  });

  it('is checking while the permission is being read', () => {
    const { reader, status } = setup({ permission: 'granted' });

    reader.activate({ usbFormat: null });

    expect(status()).toBe('checking');
  });

  it('calls scan() synchronously on start(), inside the tap (user activation)', async () => {
    const { nfc, reader, status } = await activated({ permission: 'prompt' });

    const started = reader.start();

    expect(nfc.scanCount()).toBe(1);
    expect(status()).toBe('starting');
    await started;
    expect(status()).toBe('active');
  });
});

describe('createWebNfcAdapter: scan outcomes', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['NotSupportedError', 'unsupported'],
    ['NotReadableError', 'off'],
    ['InvalidStateError', 'off'],
  ] as const)('%s → %s', async (error, expected) => {
    const { status } = await activated({ permission: 'granted', scanOutcomes: [error] });

    expect(status()).toBe(expected);
  });

  it('a tap after NotAllowedError on prompt tries again and stays denied when refused', async () => {
    const { nfc, reader, status } = await activated({
      permission: 'prompt',
      scanOutcomes: ['NotAllowedError'],
    });

    await reader.start();
    expect(status()).toBe('denied');

    nfc.failNextScan('NotAllowedError');
    await reader.start();
    expect(nfc.scanCount()).toBe(2);
    expect(status()).toBe('denied');
  });
});

describe('createWebNfcAdapter: "torna qui" (criterion 3)', () => {
  it('NFC off in the phone settings → off; back on the page with granted → new scan and active', async () => {
    const { nfc, status } = await activated({
      permission: 'granted',
      scanOutcomes: ['NotReadableError'],
    });
    expect(status()).toBe('off');

    nfc.returnToPage();
    await settle();

    expect(nfc.scanCount()).toBe(2);
    expect(status()).toBe('active');
  });

  it('back on the page with prompt → no scan and needs-permission', async () => {
    const { nfc, status } = await activated({
      permission: 'granted',
      scanOutcomes: ['NotReadableError'],
    });
    nfc.setPermission('prompt');

    nfc.returnToPage();
    await settle();

    expect(nfc.scanCount()).toBe(1);
    expect(status()).toBe('needs-permission');
  });

  it('back on the page with denied → no scan and still denied', async () => {
    const { nfc, status } = await activated({ permission: 'denied' });

    nfc.returnToPage();
    await settle();

    expect(nfc.scanCount()).toBe(0);
    expect(status()).toBe('denied');
  });

  it('denied, then allowed in the site settings: back on the page scans again', async () => {
    const { nfc, status } = await activated({ permission: 'denied' });
    nfc.setPermission('granted');

    nfc.returnToPage();
    await settle();

    expect(nfc.scanCount()).toBe(1);
    expect(status()).toBe('active');
  });

  it('while active, coming back to the page does not start another scan', async () => {
    const { nfc, status } = await activated({ permission: 'granted' });

    nfc.returnToPage();
    await settle();

    expect(nfc.scanCount()).toBe(1);
    expect(nfc.abortedCount()).toBe(0);
    expect(status()).toBe('active');
  });

  it('while asking for permission, coming back to the page does not scan', async () => {
    const { nfc, status } = await activated({ permission: 'prompt' });

    nfc.returnToPage();
    await settle();

    expect(nfc.scanCount()).toBe(0);
    expect(status()).toBe('needs-permission');
  });

  it('NFC turned on from the quick settings (no visibility change): "Riprova" restarts', async () => {
    const { reader, status } = await activated({
      permission: 'granted',
      scanOutcomes: ['NotReadableError'],
    });

    await reader.start();

    expect(status()).toBe('active');
  });
});

describe('createWebNfcAdapter: restart and stop (criterion 7)', () => {
  it('start() twice aborts the first scan before the second: never two scans at once', async () => {
    const { nfc, reader, status } = await activated({ permission: 'prompt' });

    await reader.start();
    await reader.start();

    expect(nfc.scanCount()).toBe(2);
    expect(nfc.scans[0]?.signal.aborted).toBe(true);
    expect(nfc.scans[1]?.signal.aborted).toBe(false);
    expect(nfc.activeScans()).toBe(1);
    expect(status()).toBe('active');
  });

  it('deactivate() aborts the scan and removes the visibility listener', async () => {
    const { nfc, reader, status } = await activated({ permission: 'granted' });
    expect(nfc.visibilityListenerCount()).toBe(1);

    reader.deactivate();

    expect(nfc.abortedCount()).toBe(1);
    expect(nfc.activeScans()).toBe(0);
    expect(nfc.visibilityListenerCount()).toBe(0);
    expect(status()).toBe('checking');
  });

  it('deactivate() while the permission is being read: no scan afterwards', async () => {
    const { nfc, reader } = setup({ permission: 'granted' });

    reader.activate({ usbFormat: null });
    reader.deactivate();
    await settle();

    expect(nfc.scanCount()).toBe(0);
    expect(reader.getState().nfc).toBe('checking');
  });

  it('start() does nothing while the service is not active', async () => {
    const { nfc, reader } = setup({ permission: 'prompt' });

    await reader.start();

    expect(nfc.scanCount()).toBe(0);
    expect(nfc.permissionQueries()).toBe(0);
  });

  it('a new session after deactivate() starts again from the permission', async () => {
    const { nfc, reader, status } = await activated({ permission: 'granted' });

    reader.deactivate();
    reader.activate({ usbFormat: null });
    await settle();

    expect(nfc.scanCount()).toBe(2);
    expect(nfc.activeScans()).toBe(1);
    expect(nfc.visibilityListenerCount()).toBe(1);
    expect(status()).toBe('active');
  });

  it('a late permission answer does not undo a tap that already started the scan', async () => {
    const { nfc, reader, status } = setup({ permission: 'prompt' });

    reader.activate({ usbFormat: null });
    const started = reader.start();
    await started;
    await settle();

    expect(nfc.scanCount()).toBe(1);
    expect(status()).toBe('active');
  });
});

describe('createWebNfcAdapter: reads', () => {
  it('hands the serial number to the service in hex, which delivers the canonical uid', async () => {
    const { nfc, reader, vibrate } = await activated({ permission: 'granted' });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    nfc.read('04:a1:b2:c3:d4:e5:f6');

    expect(consumer).toHaveBeenCalledWith({ uid: UID, source: 'web-nfc', at: 1_000_000 });
    expect(vibrate).toHaveBeenCalledWith(80);
  });

  it('ignores readingerror outside a write: no read, no vibration, no error', async () => {
    const { nfc, reader, vibrate } = await activated({ permission: 'granted' });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    nfc.readError();

    expect(consumer).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('an aborted scan no longer delivers, even if its reader still fires', async () => {
    const { nfc, reader } = await activated({ permission: 'granted' });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);
    const first = nfc.scans[0];

    await reader.start();
    first?.reader.onreading?.(
      Object.assign(new Event('reading'), {
        serialNumber: '04:a1:b2:c3:d4:e5:f6',
        message: { records: [] },
      }) as NDEFReadingEvent,
    );

    expect(consumer).not.toHaveBeenCalled();
  });

  it('notifies the subscribers when the status changes', async () => {
    const { reader } = setup({ permission: 'granted' });
    const seen: string[] = [];
    reader.subscribe(() => seen.push(reader.getState().nfc));

    reader.activate({ usbFormat: null });
    await settle();

    expect(seen).toEqual(['starting', 'active']);
  });
});

describe('createWebNfcAdapter: links and unreadable tags go only to the writer (SPEC point 9)', () => {
  const URL = 'https://example.test/p/invented-token';

  it('hands the url records, decoded, to an open write session; other records are left out', async () => {
    const { nfc, reader } = await activated({ permission: 'granted' });
    const onRead = vi.fn<WriteSessionConsumer>();
    const session = reader.openWriteSession(onRead);

    nfc.read('04:a1:b2:c3:d4:e5:f6', { urls: [URL], texts: ['invented text'] });

    expect(onRead).toHaveBeenCalledWith(
      { uid: UID, source: 'web-nfc', at: 1_000_000 },
      { urls: [URL], blank: false },
    );
    session.close();
  });

  it('decodes non-ASCII links as UTF-8', async () => {
    const { nfc, reader } = await activated({ permission: 'granted' });
    const onRead = vi.fn<WriteSessionConsumer>();
    const session = reader.openWriteSession(onRead);
    const accented = 'https://example.test/p/caffè';

    nfc.read(UID, { urls: [accented] });

    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ uid: UID }), {
      urls: [accented],
      blank: false,
    });
    session.close();
  });

  it('a card with no url record reaches the writer with no urls', async () => {
    const { nfc, reader } = await activated({ permission: 'granted' });
    const onRead = vi.fn<WriteSessionConsumer>();
    const session = reader.openWriteSession(onRead);

    nfc.read(UID, { texts: ['invented text'] });

    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ uid: UID }), {
      urls: [],
      blank: false,
    });
    session.close();
  });

  // SPEC-customers-v2, point 4: "vuota" is strict, zero records or only `empty` records.
  it.each([
    ['no record at all', {}, true],
    ['one empty record', { empties: 1 }, true],
    ['only empty records', { empties: 3 }, true],
    ['a text record', { texts: ['invented text'] }, false],
    ['an empty and a text record', { empties: 1, texts: ['invented text'] }, false],
    ['a mime record', { mimes: ['application/octet-stream'] }, false],
    ['an empty and a mime record', { empties: 1, mimes: ['text/plain'] }, false],
    ['a url record', { urls: [URL] }, false],
  ] as const)('a card with %s reaches the writer with blank %s', async (_label, content, blank) => {
    const { nfc, reader } = await activated({ permission: 'granted' });
    const onRead = vi.fn<WriteSessionConsumer>();
    const session = reader.openWriteSession(onRead);

    nfc.read(UID, content);

    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead.mock.calls[0]?.[1].blank).toBe(blank);
    session.close();
  });

  it('a blank card reaches a consumer as the uid alone, never with blank', async () => {
    const { nfc, reader } = await activated({ permission: 'granted' });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);
    const otherUid = '04112233445566';

    nfc.read(UID);
    nfc.read(otherUid, { empties: 1 });

    expect(consumer.mock.calls).toStrictEqual([
      [{ uid: UID, source: 'web-nfc', at: 1_000_000 }],
      [{ uid: otherUid, source: 'web-nfc', at: 1_000_000 }],
    ]);
  });

  it('hands readingerror to an open write session', async () => {
    const { nfc, reader } = await activated({ permission: 'granted' });
    const onUnreadable = vi.fn<() => void>();
    const session = reader.openWriteSession(() => {}, { onUnreadable });

    nfc.readError();

    expect(onUnreadable).toHaveBeenCalledTimes(1);
    session.close();
    nfc.readError();
    expect(onUnreadable).toHaveBeenCalledTimes(1);
  });

  it('outside a write, consumers get the uid only: never the links, never readingerror', async () => {
    const { nfc, reader } = await activated({ permission: 'granted' });
    const consumer = vi.fn<CardConsumer>();
    reader.pushConsumer(consumer);

    nfc.readError();
    nfc.read(UID, { urls: [URL] });

    expect(consumer).toHaveBeenCalledTimes(1);
    const call = consumer.mock.calls[0];
    expect(call).toHaveLength(1);
    expect(call?.[0]).toStrictEqual({ uid: UID, source: 'web-nfc', at: 1_000_000 });
  });
});

/** A stand-in for `window` with a controllable visibility. */
function fakeHost(
  options: {
    NDEFReader?: NDEFReaderConstructor;
    query?: BrowserNfcHost['navigator']['permissions']['query'];
  } = {},
) {
  const events = new EventTarget();
  let visibility: DocumentVisibilityState = 'hidden';
  const host: BrowserNfcHost = {
    NDEFReader: options.NDEFReader,
    navigator: {
      permissions: { query: options.query ?? (() => Promise.resolve({ state: 'prompt' })) },
    },
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (type, listener) => {
        events.addEventListener(type, listener);
      },
      removeEventListener: (type, listener) => {
        events.removeEventListener(type, listener);
      },
    },
  };
  return {
    host,
    show: (state: DocumentVisibilityState) => {
      visibility = state;
      events.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

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

const unknownPermission = () => Promise.reject(new TypeError('unknown permission'));

describe('createBrowserWebNfcApi', () => {
  it('is supported only with NDEFReader', () => {
    expect(createBrowserWebNfcApi(fakeHost().host).isSupported()).toBe(false);
    expect(createBrowserWebNfcApi(fakeHost({ NDEFReader: StubReader }).host).isSupported()).toBe(
      true,
    );
  });

  it('can write only with an NDEFReader that has write()', () => {
    class ReadOnlyReader extends StubReader {}
    // An NDEFReader that scans but cannot write (no write() on its prototype).
    Object.defineProperty(ReadOnlyReader.prototype, 'write', { value: undefined });

    expect(createBrowserWebNfcApi(fakeHost().host).isWriteSupported()).toBe(false);
    expect(
      createBrowserWebNfcApi(fakeHost({ NDEFReader: ReadOnlyReader }).host).isWriteSupported(),
    ).toBe(false);
    expect(
      createBrowserWebNfcApi(fakeHost({ NDEFReader: StubReader }).host).isWriteSupported(),
    ).toBe(true);
  });

  it('queries the nfc permission and returns its state', async () => {
    const query = vi.fn<BrowserNfcHost['navigator']['permissions']['query']>(() =>
      Promise.resolve({ state: 'granted' }),
    );
    const api = createBrowserWebNfcApi(fakeHost({ query }).host);

    await expect(api.queryPermission()).resolves.toBe('granted');
    expect(query).toHaveBeenCalledWith({ name: 'nfc' });
  });

  it('returns null when the browser does not know the nfc permission', async () => {
    const api = createBrowserWebNfcApi(fakeHost({ query: unknownPermission }).host);

    await expect(api.queryPermission()).resolves.toBeNull();
  });

  it('creates a real reader only when NDEFReader exists', () => {
    expect(
      createBrowserWebNfcApi(fakeHost({ NDEFReader: StubReader }).host).createReader(),
    ).toBeInstanceOf(StubReader);
    expect(() => createBrowserWebNfcApi(fakeHost().host).createReader()).toThrow(ReferenceError);
  });

  it('creates a writer from NDEFReader only when it exists', () => {
    expect(
      createBrowserWebNfcApi(fakeHost({ NDEFReader: StubReader }).host).createWriter(),
    ).toBeInstanceOf(StubReader);
    expect(() => createBrowserWebNfcApi(fakeHost().host).createWriter()).toThrow(ReferenceError);
  });

  it('calls back only when the page becomes visible, until removed', () => {
    const { host, show } = fakeHost();
    const listener = vi.fn<() => void>();
    const remove = createBrowserWebNfcApi(host).onVisible(listener);

    show('hidden');
    expect(listener).not.toHaveBeenCalled();
    show('visible');
    expect(listener).toHaveBeenCalledTimes(1);

    remove();
    show('visible');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
