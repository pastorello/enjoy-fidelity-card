import type { NfcInputAdapter, NfcStatus } from './cardReader';

export type NfcPermission = 'granted' | 'prompt' | 'denied';

/** The part of `NDEFReader` the adapter uses (a real `NDEFReader` satisfies it). */
export interface NfcReaderLike {
  onreading: ((event: NDEFReadingEvent) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
  scan(options: { signal: AbortSignal }): Promise<void>;
}

/**
 * The part of `NDEFReader` the writer uses (a real `NDEFReader` satisfies it). `makeReadOnly()` is
 * deliberately missing: cards stay writable (SPEC-card-input, point 3).
 */
export interface NfcWriterLike {
  write(
    message: NDEFMessageInit,
    options: { overwrite: boolean; signal: AbortSignal },
  ): Promise<void>;
}

/** Everything the adapter needs from the browser, so tests can run it with `fakeWebNfc`. */
export interface WebNfcApi {
  /** True only when `NDEFReader` exists (Chrome for Android over HTTPS). */
  isSupported: () => boolean;
  /** The `nfc` permission, or null when the browser cannot tell. */
  queryPermission: () => Promise<NfcPermission | null>;
  createReader: () => NfcReaderLike;
  /** True only when `NDEFReader` exists and has `write()` (SPEC-card-input, point 5: `canWrite`). */
  isWriteSupported: () => boolean;
  /** A fresh `NDEFReader` used only to write (SPEC-card-input, point 9). */
  createWriter: () => NfcWriterLike;
  /** Calls `listener` each time the page becomes visible again; returns the remover. */
  onVisible: (listener: () => void) => () => void;
}

/** The parts of `window` the real API uses; `window` itself satisfies it. */
export type BrowserNfcHost = {
  readonly NDEFReader?: NDEFReaderConstructor | undefined;
  readonly navigator: {
    readonly permissions: {
      query(descriptor: { name: 'nfc' }): Promise<{ readonly state: PermissionState }>;
    };
  };
  readonly document: {
    readonly visibilityState: DocumentVisibilityState;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
    removeEventListener(type: 'visibilitychange', listener: () => void): void;
  };
};

/** The real `WebNfcApi` over a browser window. */
export function createBrowserWebNfcApi(win: BrowserNfcHost): WebNfcApi {
  return {
    isSupported: () => typeof win.NDEFReader === 'function',
    isWriteSupported: () =>
      typeof win.NDEFReader === 'function' && typeof win.NDEFReader.prototype.write === 'function',
    async queryPermission() {
      try {
        const status = await win.navigator.permissions.query({ name: 'nfc' });
        return status.state;
      } catch {
        // Browsers without Web NFC do not know the 'nfc' permission (TypeError).
        return null;
      }
    },
    createReader() {
      const NDEFReader = win.NDEFReader;
      if (NDEFReader === undefined) throw new ReferenceError('NDEFReader is not available');
      return new NDEFReader();
    },
    createWriter() {
      const NDEFReader = win.NDEFReader;
      if (NDEFReader === undefined) throw new ReferenceError('NDEFReader is not available');
      return new NDEFReader();
    },
    onVisible(listener) {
      const doc = win.document;
      const onChange = () => {
        if (doc.visibilityState === 'visible') listener();
      };
      doc.addEventListener('visibilitychange', onChange);
      return () => {
        doc.removeEventListener('visibilitychange', onChange);
      };
    },
  };
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
}

/**
 * The links of the `url` records, decoded as UTF-8 (SPEC-card-input, point 3). Only a running write
 * gets them, to verify what it wrote: they hold a customer's token, so they are never logged.
 */
function urlsOf(message: NDEFMessage | undefined): string[] {
  const urls: string[] = [];
  const decoder = new TextDecoder();
  for (const record of message?.records ?? []) {
    // Not fatal: broken bytes decode to U+FFFD, which never matches the link that was written.
    if (record.recordType === 'url' && record.data !== undefined) {
      urls.push(decoder.decode(record.data));
    }
  }
  return urls;
}

/** What a failed `scan()` means for the panel (SPEC-card-input, point 3). */
function statusForScanError(error: unknown): NfcStatus {
  switch (errorName(error)) {
    case 'NotAllowedError':
      return 'denied';
    case 'NotSupportedError':
      return 'unsupported';
    default:
      // NotReadableError (NFC off in the phone settings) and anything unexpected.
      return 'off';
  }
}

/**
 * Card reading with Web NFC (SPEC-card-input, point 3). Scans by itself only when the permission is
 * already granted; the first `scan()` comes from a tap (`restart`). Never two scans at once, and
 * "torna qui": back on the page after NFC was off or denied, it scans again only if the permission
 * is granted. Never logs: a serial number identifies a customer's card.
 */
export function createWebNfcAdapter(api: WebNfcApi): NfcInputAdapter {
  type Ports = Parameters<NfcInputAdapter['start']>[0];
  let ports: Ports | null = null;
  let status: NfcStatus = 'checking';
  let scan: AbortController | null = null;
  let stopVisibility: (() => void) | null = null;

  function setStatus(next: NfcStatus) {
    status = next;
    ports?.setStatus(next);
  }

  function abortScan() {
    scan?.abort();
    scan = null;
  }

  async function readPermission(): Promise<NfcPermission | null> {
    try {
      return await api.queryPermission();
    } catch {
      return null;
    }
  }

  /** Starts a scan, stopping the running one first. `scan()` is called synchronously (user activation). */
  async function runScan(): Promise<void> {
    abortScan();
    const controller = new AbortController();
    scan = controller;
    setStatus('starting');
    try {
      const reader = api.createReader();
      reader.onreading = (event) => {
        if (scan === controller) {
          ports?.deliver(event.serialNumber, 'hex', 'web-nfc', urlsOf(event.message));
        }
      };
      // An unreadable tag (damaged NDEF message, no uid) matters only to a running write, which the
      // service tells; outside a write it is dropped: the operator holds the card again or searches
      // the customer by name.
      reader.onreadingerror = () => {
        if (scan === controller) ports?.unreadable();
      };
      await reader.scan({ signal: controller.signal });
      if (scan === controller) setStatus('active');
    } catch (error) {
      if (scan !== controller) return; // Aborted by us: a newer scan or stop() owns the status.
      scan = null;
      setStatus(statusForScanError(error));
    }
  }

  /** At start: scan at once only with the permission granted, otherwise wait for a tap. */
  async function startFromPermission(owner: Ports) {
    const permission = await readPermission();
    // Stopped, or a tap already started a scan, while the permission was being read.
    if (ports !== owner || status !== 'checking') return;
    if (permission === 'granted') await runScan();
    else setStatus(permission === 'denied' ? 'denied' : 'needs-permission');
  }

  /** "torna qui": back on the page after NFC was off or the permission denied. */
  async function retryOnReturn(owner: Ports) {
    if (status !== 'off' && status !== 'denied') return;
    const permission = await readPermission();
    if (ports !== owner || (status !== 'off' && status !== 'denied')) return;
    if (permission === 'granted') await runScan();
    else if (permission === 'denied') setStatus('denied');
    else setStatus('needs-permission');
  }

  return {
    start(given) {
      if (ports !== null) return;
      const owner: Ports = {
        deliver: given.deliver,
        setStatus: given.setStatus,
        unreadable: given.unreadable,
      };
      ports = owner;
      if (!api.isSupported()) {
        setStatus('unsupported');
        return;
      }
      setStatus('checking');
      stopVisibility = api.onVisible(() => {
        void retryOnReturn(owner);
      });
      void startFromPermission(owner);
    },
    stop() {
      ports = null;
      abortScan();
      stopVisibility?.();
      stopVisibility = null;
      status = 'checking';
    },
    async restart() {
      if (ports === null || status === 'unsupported') return;
      await runScan();
    },
  };
}
