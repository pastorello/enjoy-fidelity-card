import { normalizeUid, type UsbUidFormat } from './normalizeUid';

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
 * How an adapter hands a raw uid to the service. `format` is a plain string at run time (it can come
 * from the saved settings): anything `normalizeUid` rejects is discarded.
 */
export type DeliverRaw = (
  raw: string,
  format: UsbUidFormat | (string & {}),
  source: CardSource,
) => void;

/** An input (Web NFC, USB keyboard wedge, E2E fake): runs only between `start` and `stop`. */
export interface CardInputAdapter {
  start(ports: { deliver: DeliverRaw }): void;
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

export type CardReaderOptions = {
  now: () => number;
  /** `navigator.vibrate` bound to navigator, when the browser has it. */
  vibrate?: ((ms: number) => unknown) | undefined;
  adapters: readonly CardInputAdapter[];
  /** The USB reader (`createKeyboardWedge`), started only while active with a non-null format. */
  usb?: UsbInputAdapter | undefined;
};

export type CardReader = {
  /** Starts the adapters (an operator is signed in). Calling it again only updates the format. */
  activate(options: { usbFormat: UsbUidFormat | null }): void;
  /** Stops the adapters; nothing is read until the next `activate`. */
  deactivate(): void;
  setUsbFormat(format: UsbUidFormat | null): void;
  /** Puts the consumer on top of the stack; the returned function removes exactly that entry. */
  pushConsumer(consumer: CardConsumer): () => void;
  getState(): CardReaderState;
  subscribe(listener: () => void): () => void;
};

/**
 * The single card-reading service of the app (SPEC-card-input, point 2): normalizes what the adapters
 * read, drops repeats and invalid uids, and delivers each read to the consumer on top of the stack only.
 * It never logs: a uid identifies a customer's card.
 */
export function createCardReader({ now, vibrate, adapters, usb }: CardReaderOptions): CardReader {
  // Each push gets its own entry object, so removal is by identity even if a function is pushed twice.
  const stack: { consumer: CardConsumer }[] = [];
  const lastSeen = new Map<string, number>();
  const listeners = new Set<() => void>();
  let active = false;
  let usbFormat: UsbUidFormat | null = null;
  let state: CardReaderState = {
    nfc: 'checking',
    canWrite: false,
    usb: { enabled: false, format: null, lastReadAt: null, lastInvalidAt: null },
  };

  function setUsbState(patch: Partial<CardReaderState['usb']>) {
    state = { ...state, usb: { ...state.usb, ...patch } };
    for (const listener of listeners) listener();
  }

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

  const deliver: DeliverRaw = (raw, format, source) => {
    if (!active) return;
    const uid = normalizeUid(raw, format);
    const at = now();
    // For the tablet header (tablet-kiosk): a valid read shows the reader is there, an invalid one
    // hints at a wrong format in the settings. Only times are kept, never the text read.
    if (source === 'usb') setUsbState(uid === null ? { lastInvalidAt: at } : { lastReadAt: at });
    if (uid === null) return;

    const previous = lastSeen.get(uid);
    lastSeen.set(uid, at);
    if (previous !== undefined && at - previous <= REPEAT_WINDOW_MS) return;

    const top = stack.at(-1);
    if (top === undefined) return;
    safeVibrate();
    top.consumer({ uid, source, at });
  };

  return {
    activate(options) {
      usbFormat = options.usbFormat;
      if (!active) {
        active = true;
        for (const adapter of adapters) adapter.start({ deliver });
      }
      updateUsb();
    },
    deactivate() {
      if (!active) return;
      active = false;
      lastSeen.clear();
      for (const adapter of adapters) adapter.stop();
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
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
