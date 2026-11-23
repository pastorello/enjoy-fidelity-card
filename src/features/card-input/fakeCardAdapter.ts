import type { CardInputAdapter, CardWriteTarget, DeliverRaw } from './cardReader';
import { normalizeUid } from './normalizeUid';
import type { NfcWriterLike } from './webNfcAdapter';
import { IN_FIELD_MS } from './webNfcWriter';

/** One link the fake writer wrote on a fake tag (the log the E2E tests read to open the link). */
export type FakeCardWrite = { uid: string; url: string; at: number };

/** How the next fake write fails (SPEC-card-input, point 7). */
export type FakeWriteFailure = 'io' | 'timeout' | 'not-allowed' | 'verify-failed' | 'unreadable';

/** The test controls of the fake writer. */
export type FakeCardControl = {
  failNextWrite(reason: FakeWriteFailure): void;
  setCanWrite(value: boolean): void;
};

declare global {
  interface Window {
    /** E2E build only: puts the card `uid` on the phone (SPEC-card-input, point 7). */
    __enjoyFakeCard?: (uid: string) => void;
    /** E2E build only: every link the fake writer wrote, in order. */
    __enjoyFakeCardWrites?: FakeCardWrite[];
    /** E2E build only: makes the next write fail, or the device unable to write. */
    __enjoyFakeCardControl?: FakeCardControl;
  }
}

/** Where the fake installs its entry points: `window` in the E2E build. */
export type FakeCardHost = Pick<
  Window,
  '__enjoyFakeCard' | '__enjoyFakeCardWrites' | '__enjoyFakeCardControl'
>;

export type FakeCard = { adapter: CardInputAdapter; writer: CardWriteTarget };

/** A fake tag: the links it holds, or damaged (an interrupted write) and giving no uid. */
type FakeTag = { urls: readonly string[]; damaged: boolean };

type PendingWrite = {
  urls: readonly string[];
  done: Promise<void>;
  resolve: () => void;
  reject: (error: DOMException) => void;
};

function domError(name: string, message: string): DOMException {
  return new DOMException(message, name);
}

function urlsOf(message: NDEFMessageInit): string[] {
  return message.records.flatMap((record) =>
    record.recordType === 'url' && typeof record.data === 'string' ? [record.data] : [],
  );
}

/**
 * The E2E card reader and writer (SPEC-card-input, point 7). `window.__enjoyFakeCard(uid)` is the card
 * put on the phone: it hands `uid` to the service as a `'fake'` read in `'hex'` (same rules as the real
 * inputs), with the links that fake tag holds, and completes a write waiting for a card. In place of
 * `NDEFReader.write()` the writer keeps the tags in memory (`uid → links`): a card put on the phone
 * less than `IN_FIELD_MS` ago is still there, so the write happens at once and the card is read back
 * for the verification without another tap. Each successful write is added to
 * `window.__enjoyFakeCardWrites`; `window.__enjoyFakeCardControl` makes the next write fail or the
 * device unable to write. Installed by `main.tsx` only when `VITE_E2E === '1'`: never part of the
 * normal build. Every global name starts with `__enjoyFakeCard`, which `check:bundle` looks for.
 */
export function createFakeCard(
  host: FakeCardHost,
  { now = () => Date.now() }: { now?: () => number } = {},
): FakeCard {
  const tags = new Map<string, FakeTag>();
  const writes: FakeCardWrite[] = [];
  const supportListeners = new Set<() => void>();
  let deliver: DeliverRaw | null = null;
  let unreadable: (() => void) | null = null;
  let lastTap: { uid: string; at: number } | null = null;
  let pending: PendingWrite | null = null;
  let nextFailure: Exclude<FakeWriteFailure, 'unreadable'> | null = null;
  let unreadableNextTap = false;
  let canWrite = true;

  /** What the phone gets from the tag `uid`: a read with its links, or no uid when damaged. */
  function present(uid: string) {
    const tag = tags.get(uid);
    if (tag?.damaged === true) unreadable?.();
    // The fake tags have no erased state: a fake card is never taken for a blank one.
    else deliver?.(uid, 'hex', 'fake', { urls: tag?.urls ?? [], blank: false });
  }

  /**
   * Writes on the tag `uid`, or fails as the test asked; when `write()` resolves, the card still on
   * the phone is read back for the verification.
   */
  function writeOnTag(uid: string, write: PendingWrite) {
    const failure = nextFailure;
    nextFailure = null;
    switch (failure) {
      case 'timeout':
        // The card is never written: write() waits until the writer gives up and aborts it.
        return;
      case 'io':
        // Card moved away halfway: a damaged NDEF message, repaired only by a new write.
        tags.set(uid, { urls: [], damaged: true });
        write.reject(domError('NetworkError', 'The fake card was moved away while writing.'));
        return;
      case 'not-allowed':
        write.reject(domError('NotAllowedError', 'Writing is not allowed.'));
        return;
      case 'verify-failed':
        // Something else ends up on the card: the read back does not hold the link.
        tags.set(uid, { urls: [], damaged: false });
        break;
      default:
        tags.set(uid, { urls: write.urls, damaged: false });
        for (const url of write.urls) writes.push({ uid, url, at: now() });
    }
    write.resolve();
    readBack(write.done, uid);
  }

  /** The card is still on the phone after the write: read back once the writer saw `write()` end. */
  function readBack(done: Promise<void>, uid: string) {
    // Whether this reaction runs before or after the writer's, the read is queued after the writer
    // has moved on to the verification.
    void done.then(() => {
      queueMicrotask(() => {
        present(uid);
      });
    });
  }

  host.__enjoyFakeCardWrites = writes;
  host.__enjoyFakeCardControl = {
    failNextWrite(reason) {
      if (reason === 'unreadable') unreadableNextTap = true;
      else nextFailure = reason;
    },
    setCanWrite(value) {
      canWrite = value;
      for (const listener of supportListeners) listener();
    },
  };
  host.__enjoyFakeCard = (raw: string) => {
    const uid = normalizeUid(raw, 'hex');
    if (uid === null) {
      deliver?.(raw, 'hex', 'fake'); // the service drops it, like any invalid read
      return;
    }
    lastTap = { uid, at: now() };
    if (unreadableNextTap) {
      unreadableNextTap = false;
      unreadable?.();
      return;
    }
    const write = pending;
    if (write !== null) {
      // Like Chrome, a waiting write() writes the first card put on the phone, whichever it is.
      pending = null;
      writeOnTag(uid, write);
    }
    present(uid);
  };

  const writer: NfcWriterLike = {
    write(message, { signal }) {
      let resolve!: () => void;
      let reject!: (error: DOMException) => void;
      const done = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      const write: PendingWrite = { urls: urlsOf(message), done, resolve, reject };
      if (signal.aborted) {
        write.reject(domError('AbortError', 'The write was aborted.'));
        return done;
      }
      signal.addEventListener(
        'abort',
        () => {
          if (pending === write) pending = null;
          write.reject(domError('AbortError', 'The write was aborted.'));
        },
        { once: true },
      );
      // A card put on the phone a moment ago is still there; otherwise wait for the next one.
      if (lastTap !== null && now() - lastTap.at < IN_FIELD_MS) writeOnTag(lastTap.uid, write);
      else pending = write;
      return done;
    },
  };

  return {
    adapter: {
      start(ports) {
        deliver = ports.deliver;
        unreadable = ports.unreadable;
      },
      stop() {
        deliver = null;
        unreadable = null;
      },
    },
    writer: {
      isWriteSupported: () => canWrite,
      createWriter: () => writer,
      subscribe(listener) {
        supportListeners.add(listener);
        return () => {
          supportListeners.delete(listener);
        };
      },
    },
  };
}
