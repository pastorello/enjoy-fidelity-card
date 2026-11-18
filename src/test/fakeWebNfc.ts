import type {
  NfcPermission,
  NfcReaderLike,
  NfcWriterLike,
  WebNfcApi,
} from '../features/card-input/webNfcAdapter';

/** How the next `scan()` ends: `'ok'` resolves, any other value rejects with a DOMException of that name. */
export type FakeScanOutcome =
  'ok' | 'NotAllowedError' | 'NotSupportedError' | 'NotReadableError' | 'InvalidStateError';

/**
 * How the next `write()` ends: `'ok'` resolves, `'pending'` waits like Chrome with no card in the field
 * (it rejects with `AbortError` once its signal aborts), any other value rejects with a DOMException of
 * that name.
 */
export type FakeWriteOutcome =
  'ok' | 'pending' | 'NotAllowedError' | 'NetworkError' | 'NotReadableError' | 'NotSupportedError';

/** One `write()` call as the page made it. */
export type FakeWrite = {
  readonly message: NDEFMessageInit;
  readonly options: { overwrite: boolean; signal: AbortSignal };
};

type FakeWebNfcOptions = {
  /** False simulates iPhone or a desktop browser: no `NDEFReader`. Default true. */
  supported?: boolean;
  /** What `permissions.query({ name: 'nfc' })` says; null when the query is not available. */
  permission?: NfcPermission | null;
  /** Outcomes of the next `scan()` calls, in order; then every scan succeeds. */
  scanOutcomes?: FakeScanOutcome[];
  /** Outcomes of the next `write()` calls, in order; then every write succeeds. */
  writeOutcomes?: FakeWriteOutcome[] | undefined;
};

function abortError() {
  return new DOMException('The write was aborted.', 'AbortError');
}

type FakeScan = { readonly reader: NfcReaderLike; readonly signal: AbortSignal; active: boolean };

/**
 * In-memory Web NFC for unit and component tests (Web NFC exists only in Chrome for Android).
 * Behaves like Chrome where card-input relies on it: a successful scan from the `prompt` state grants
 * the permission, `NotAllowedError` denies it, an aborted scan stops reading. Only invented uids.
 */
export function createFakeWebNfc(options: FakeWebNfcOptions = {}) {
  const supported = options.supported ?? true;
  let permission: NfcPermission | null =
    options.permission === undefined ? 'granted' : options.permission;
  const outcomes = [...(options.scanOutcomes ?? [])];
  const scans: FakeScan[] = [];
  const visibilityListeners = new Set<() => void>();
  let permissionQueries = 0;
  const writeOutcomes = [...(options.writeOutcomes ?? [])];
  const writes: FakeWrite[] = [];
  let makeReadOnlyCalls = 0;

  // Like NDEFReader, the writer also has makeReadOnly(): counted, so tests prove it is never called.
  function createWriter(): NfcWriterLike & { makeReadOnly(): Promise<void> } {
    return {
      write(message, writeOptions) {
        writes.push({ message, options: writeOptions });
        const outcome = writeOutcomes.shift() ?? 'ok';
        const { signal } = writeOptions;
        if (signal.aborted) return Promise.reject(abortError());
        if (outcome === 'ok') return Promise.resolve();
        if (outcome === 'pending') {
          return new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(abortError());
            });
          });
        }
        return Promise.reject(new DOMException('Fake write failure.', outcome));
      },
      makeReadOnly() {
        makeReadOnlyCalls += 1;
        return Promise.resolve();
      },
    };
  }

  function createReader(): NfcReaderLike {
    const reader: NfcReaderLike = {
      onreading: null,
      onreadingerror: null,
      scan({ signal }) {
        const scan: FakeScan = { reader, signal, active: false };
        scans.push(scan);
        const outcome = outcomes.shift() ?? 'ok';
        signal.addEventListener('abort', () => {
          scan.active = false;
        });
        if (signal.aborted) {
          return Promise.reject(new DOMException('The scan was aborted.', 'AbortError'));
        }
        if (outcome !== 'ok') {
          if (outcome === 'NotAllowedError') permission = 'denied';
          return Promise.reject(new DOMException('Fake scan failure.', outcome));
        }
        if (permission === 'prompt' || permission === null) permission = 'granted';
        scan.active = true;
        return Promise.resolve();
      },
    };
    return reader;
  }

  const api: WebNfcApi = {
    isSupported: () => supported,
    queryPermission: () => {
      permissionQueries += 1;
      return Promise.resolve(permission);
    },
    createReader: () => {
      if (!supported) throw new ReferenceError('NDEFReader is not defined');
      return createReader();
    },
    createWriter: () => {
      if (!supported) throw new ReferenceError('NDEFReader is not defined');
      return createWriter();
    },
    onVisible(listener) {
      visibilityListeners.add(listener);
      return () => {
        visibilityListeners.delete(listener);
      };
    },
  };

  return {
    api,
    /** Every `scan()` call so far, oldest first. */
    scans,
    scanCount: () => scans.length,
    /** How many scans have been stopped with `abort()`. */
    abortedCount: () => scans.filter((scan) => scan.signal.aborted).length,
    activeScans: () => scans.filter((scan) => scan.active).length,
    permissionQueries: () => permissionQueries,
    /** Every `write()` call so far, oldest first. */
    writes,
    /** How many times `makeReadOnly()` was called: must stay 0 (cards stay writable). */
    makeReadOnlyCalls: () => makeReadOnlyCalls,
    /** Queues the outcome of the next `write()`. */
    queueWrite(outcome: FakeWriteOutcome) {
      writeOutcomes.push(outcome);
    },
    /** Changes the permission, as the site settings of Chrome would. */
    setPermission(value: NfcPermission | null) {
      permission = value;
    },
    /** Queues the outcome of the next `scan()`. */
    failNextScan(outcome: Exclude<FakeScanOutcome, 'ok'>) {
      outcomes.push(outcome);
    },
    /** The operator comes back to the app (`visibilitychange` → `visible`). */
    returnToPage() {
      for (const listener of visibilityListeners) listener();
    },
    visibilityListenerCount: () => visibilityListeners.size,
    /** A card held to the phone: every active scan reports it, like Chrome does. */
    read(serialNumber: string) {
      for (const scan of scans) {
        if (!scan.active) continue;
        const event = Object.assign(new Event('reading'), {
          serialNumber,
          message: { records: [] },
        }) as NDEFReadingEvent;
        scan.reader.onreading?.(event);
      }
    },
    /** A tag Chrome cannot read (`readingerror`, no uid). */
    readError() {
      for (const scan of scans) {
        if (scan.active) scan.reader.onreadingerror?.(new Event('readingerror'));
      }
    },
  };
}

export type FakeWebNfc = ReturnType<typeof createFakeWebNfc>;
