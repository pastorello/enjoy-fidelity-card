import { normalizeUid, type UsbUidFormat } from './normalizeUid';
import type { WebNfcApi } from './webNfcAdapter';
import { createWebNfcWriter, type WriteUrl } from './webNfcWriter';

/** The same uid read again within this window from its last read (delivered or not) is ignored. */
export const REPEAT_WINDOW_MS = 2000;
/** Length of the vibration when a read reaches a consumer. */
const VIBRATION_MS = 80;

export type CardSource = 'web-nfc' | 'usb' | 'fake';

/** A card read as consumers see it: the canonical uid (upper-case hex), never a URL. */
export type CardRead = { uid: string; source: CardSource; at: number };

export type NfcStatus =
  'checking' | 'needs-permission' | 'starting' | 'active' | 'denied' | 'off' | 'unsupported';

export type CardReaderState = {
  nfc: NfcStatus;
  canWrite: boolean;
  usb: {
    enabled: boolean;
    format: UsbUidFormat | null;
    lastReadAt: number | null;
    lastInvalidAt: number | null;
  };
};

export type CardConsumer = (read: CardRead) => void;

/**
 * What the writer gets for each read during a write: the read and the links (`url` records) the card
 * holds, needed only to verify the write. Links never reach a `CardConsumer`.
 */
export type WriteSessionConsumer = (read: CardRead, urls: readonly string[]) => void;

/** The other events of a write session (SPEC-card-input, point 9). */
export type WriteSessionEvents = {
  /** A tag Chrome could not read (`readingerror`: no uid, e.g. a damaged NDEF message). */
  onUnreadable?: (() => void) | undefined;
  /** `start()` was called: the scan restarts, so the write cannot go on. */
  onInterrupt?: (() => void) | undefined;
};

/**
 * A write in progress (SPEC-card-input, point 9): until `close()` every valid read goes only to the
 * writer, without the repeat window. `lastRead` is the latest valid read before the session opened,
 * delivered or not, so the writer can tell whether the card is still on the phone.
 */
export type WriteSession = { readonly lastRead: CardRead | null; close(): void };

/**
 * How an adapter hands a raw uid to the service. `format` is a plain string at run time (it can come
 * from the saved settings): anything `normalizeUid` rejects is discarded. `urls` are the links the
 * card holds (Web NFC only): they go to a running write and nowhere else.
 */
export type DeliverRaw = (
  raw: string,
  format: UsbUidFormat | (string & {}),
  source: CardSource,
  urls?: readonly string[],
) => void;

/**
 * An input (E2E fake): runs only between `start` and `stop`. `unreadable` reports a tag that gives no
 * uid (a damaged one), which matters only to a running write.
 */
export interface CardInputAdapter {
  start(ports: { deliver: DeliverRaw; unreadable: () => void }): void;
  stop(): void;
}

/**
 * The USB keyboard-wedge reader: unlike the other adapters it runs only while a USB format is known
 * (never with a guessed one), and reads the current format at each read.
 */
export interface UsbInputAdapter {
  start(ports: { deliver: DeliverRaw; format: () => UsbUidFormat | null }): void;
  stop(): void;
}

/**
 * The Web NFC reader (`createWebNfcAdapter`): besides reads it reports its status and unreadable tags
 * (`unreadable`, used only by a running write), and `restart()` starts the scan again from an
 * operator's tap ("Attiva la lettura", "Riprova la lettura").
 */
export interface NfcInputAdapter {
  start(ports: {
    deliver: DeliverRaw;
    setStatus: (status: NfcStatus) => void;
    unreadable: () => void;
  }): void;
  stop(): void;
  restart(): Promise<void>;
}

/**
 * Where links are written (SPEC-card-input, point 9): the browser's `WebNfcApi`, or in E2E builds the
 * fake tags of `fakeCardAdapter`. `isWriteSupported()` is false without an `NDEFReader` with `write()`.
 * `subscribe` (the E2E fake only, `setCanWrite`) reports that `isWriteSupported()` may have changed.
 */
export type CardWriteTarget = Pick<WebNfcApi, 'isWriteSupported' | 'createWriter'> & {
  subscribe?: ((listener: () => void) => () => void) | undefined;
};

/** Stands in when the service has nothing to write with: `canWrite` stays false. */
const NO_WRITE_TARGET: CardWriteTarget = {
  isWriteSupported: () => false,
  createWriter: () => {
    throw new ReferenceError('No card writer is available');
  },
};

export type CardReaderOptions = {
  now: () => number;
  /** `navigator.vibrate` bound to navigator, when the browser has it. */
  vibrate?: ((ms: number) => unknown) | undefined;
  adapters: readonly CardInputAdapter[];
  /** The USB reader (`createKeyboardWedge`), started only while active with a non-null format. */
  usb?: UsbInputAdapter | undefined;
  /** The Web NFC reader, started and stopped with the service. */
  nfc?: NfcInputAdapter | undefined;
  /** Where `writeUrl` writes; without it `canWrite` is always false. */
  writer?: CardWriteTarget | undefined;
};

export type CardReader = {
  /** Starts the adapters (an operator is signed in). Calling it again only updates the format. */
  activate(options: { usbFormat: UsbUidFormat | null }): void;
  /**
   * Stops the adapters; nothing is read until the next `activate`. A write in progress is interrupted
   * first (`onInterrupt`).
   */
  deactivate(): void;
  setUsbFormat(format: UsbUidFormat | null): void;
  /** Puts the consumer on top of the stack; the returned function removes exactly that entry. */
  pushConsumer(consumer: CardConsumer): () => void;
  /** Opens the exclusive write session; one at a time (a second one is a programming error). */
  openWriteSession(onRead: WriteSessionConsumer, events?: WriteSessionEvents): WriteSession;
  /**
   * Starts the Web NFC scan again from a tap; does nothing while the service is not active. A write
   * in progress is interrupted first (`onInterrupt`): its verification needs the scan running.
   */
  start(): Promise<void>;
  /**
   * Writes a link on the expected card (SPEC-card-input, point 9). Refuses with `cannot-write` unless
   * `canWrite`: Web NFC `active` and a writer with `write()`; the USB reader never writes.
   */
  writeUrl: WriteUrl;
  getState(): CardReaderState;
  subscribe(listener: () => void): () => void;
};

/**
 * The single card-reading service of the app (SPEC-card-input, point 2): normalizes what the adapters
 * read, drops repeats and invalid uids, and delivers each read to the consumer on top of the stack only.
 * It never logs: a uid identifies a customer's card.
 */
export function createCardReader({
  now,
  vibrate,
  adapters,
  usb,
  nfc,
  writer: writeTarget = NO_WRITE_TARGET,
}: CardReaderOptions): CardReader {
  // Each push gets its own entry object, so removal is by identity even if a function is pushed twice.
  const stack: { consumer: CardConsumer }[] = [];
  const lastSeen = new Map<string, number>();
  const listeners = new Set<() => void>();
  let lastRead: CardRead | null = null;
  let session: ({ onRead: WriteSessionConsumer } & WriteSessionEvents) | null = null;
  let active = false;
  let usbFormat: UsbUidFormat | null = null;
  let state: CardReaderState = {
    nfc: 'checking',
    canWrite: false,
    usb: { enabled: false, format: null, lastReadAt: null, lastInvalidAt: null },
  };

  function notify() {
    for (const listener of listeners) listener();
  }

  function setUsbState(patch: Partial<CardReaderState['usb']>) {
    state = { ...state, usb: { ...state.usb, ...patch } };
    notify();
  }

  function setNfcStatus(status: NfcStatus) {
    // Writing needs the scan running (to recognize the card and verify the link) and write().
    const canWrite = status === 'active' && writeTarget.isWriteSupported();
    if (state.nfc === status && state.canWrite === canWrite) return;
    state = { ...state, nfc: status, canWrite };
    notify();
  }

  // The writer's support can change at run time (E2E fake): canWrite follows it.
  writeTarget.subscribe?.(() => {
    setNfcStatus(state.nfc);
  });

  // A status reported by an adapter that has been stopped meanwhile is stale.
  const reportNfcStatus = (status: NfcStatus) => {
    if (active) setNfcStatus(status);
  };

  // An unreadable tag matters only to a running write; otherwise it is dropped in silence.
  const reportUnreadable = () => {
    if (active) session?.onUnreadable?.();
  };

  function updateUsb() {
    const enabled = active && usbFormat !== null;
    const wasEnabled = state.usb.enabled;
    if (enabled && !wasEnabled) usb?.start({ deliver, format: () => usbFormat });
    if (!enabled && wasEnabled) usb?.stop();
    if (wasEnabled === enabled && state.usb.format === usbFormat) return;
    setUsbState({ enabled, format: usbFormat });
  }

  function safeVibrate() {
    try {
      vibrate?.(VIBRATION_MS);
    } catch {
      // The browser may refuse to vibrate (no user gesture yet): the read still counts.
    }
  }

  const deliver: DeliverRaw = (raw, format, source, urls = []) => {
    if (!active) return;
    const uid = normalizeUid(raw, format);
    const at = now();
    // For the tablet header (tablet-kiosk): a valid read shows the reader is there, an invalid one
    // hints at a wrong format in the settings. Only times are kept, never the text read.
    if (source === 'usb') setUsbState(uid === null ? { lastInvalidAt: at } : { lastReadAt: at });
    if (uid === null) return;

    const read: CardRead = { uid, source, at };
    const previous = lastSeen.get(uid);
    // Reads during a write still count for the repeat window: the card just written, still on the
    // phone, is not a new read for the screen once the write ends.
    lastSeen.set(uid, at);
    lastRead = read;
    if (session !== null) {
      session.onRead(read, [...urls]);
      return;
    }
    if (previous !== undefined && at - previous <= REPEAT_WINDOW_MS) return;

    const top = stack.at(-1);
    if (top === undefined) return;
    safeVibrate();
    top.consumer(read);
  };

  function openWriteSession(
    onRead: WriteSessionConsumer,
    events: WriteSessionEvents = {},
  ): WriteSession {
    if (session !== null) throw new Error('A card write session is already open.');
    const entry = { onRead, ...events };
    session = entry;
    return {
      lastRead,
      close() {
        if (session === entry) session = null;
      },
    };
  }

  const writer = createWebNfcWriter({
    api: writeTarget,
    reader: { openWriteSession },
    now,
    canWrite: () => state.canWrite,
    vibrate,
  });

  return {
    activate(options) {
      usbFormat = options.usbFormat;
      if (!active) {
        active = true;
        for (const adapter of adapters) adapter.start({ deliver, unreadable: reportUnreadable });
        nfc?.start({ deliver, setStatus: reportNfcStatus, unreadable: reportUnreadable });
      }
      updateUsb();
    },
    deactivate() {
      if (!active) return;
      // A write cannot outlive the signed-in operator: it ends as `aborted`, its write() is aborted
      // and the session is closed, so the next card on the phone cannot get the link.
      session?.onInterrupt?.();
      active = false;
      lastSeen.clear();
      lastRead = null;
      for (const adapter of adapters) adapter.stop();
      nfc?.stop();
      setNfcStatus('checking');
      updateUsb();
    },
    setUsbFormat(format) {
      usbFormat = format;
      updateUsb();
    },
    pushConsumer(consumer) {
      const entry = { consumer };
      stack.push(entry);
      return () => {
        const index = stack.indexOf(entry);
        if (index !== -1) stack.splice(index, 1);
      };
    },
    openWriteSession,
    writeUrl: writer.writeUrl,
    async start() {
      session?.onInterrupt?.();
      if (active) await nfc?.restart();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
