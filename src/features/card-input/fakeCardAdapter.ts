import type { CardContent, CardInputAdapter, CardWriteTarget, DeliverRaw } from './cardReader';
import { normalizeUid } from './normalizeUid';
import type { NfcWriterLike } from './webNfcAdapter';
import { IN_FIELD_MS } from './webNfcWriter';

/**
 * One write of the fake writer on a fake tag (the log the E2E tests read to open the link): the link
 * written, or `null` for a card erased by `eraseCard` (SPEC-customers-v2, point 4).
 */
export type FakeCardWrite = { uid: string; url: string | null; at: number };

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
    /** E2E build only: every link the fake writer wrote (`url: null` for an erased card), in order. */
    __enjoyFakeCardWrites?: FakeCardWrite[];
    /** E2E build only: makes the next write or erase fail, or the device unable to write. */
    __enjoyFakeCardControl?: FakeCardControl;
  }
}

/** Where the fake installs its entry points: `window` in the E2E build. */
export type FakeCardHost = Pick<
  Window,
  '__enjoyFakeCard' | '__enjoyFakeCardWrites' | '__enjoyFakeCardControl'
>;

export type FakeCard = { adapter: CardInputAdapter; writer: CardWriteTarget };

/**
 * What a fake tag holds: one link, or `url: null` when blank (new or erased: no record but `empty`
 * ones); `foreign` for another content (neither a link of ours nor blank, say a text record);
 * `damaged` (an interrupted write) when it gives no uid. A tag never written is blank.
 */
type FakeTag = { kind: 'url'; url: string | null } | { kind: 'foreign' } | { kind: 'damaged' };

const BLANK_TAG: FakeTag = { kind: 'url', url: null };

/** What a write puts on the tag: the link of its `url` record, or `null` for only `empty` records. */
type PendingWrite = {
  url: string | null;
  done: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

function domError(name: string, message: string): DOMException {
  return new DOMException(message, name);
}

/**
 * The content of a message as the fake tag keeps it: the link of its one `url` record, `null` for one
 * `empty` record (an erased card), `undefined` for any other message, which the app never writes.
 */
function contentOf(message: NDEFMessageInit): string | null | undefined {
  const [record, ...rest] = message.records;
  if (record === undefined || rest.length > 0) return undefined;
  if (record.recordType === 'empty') return null;
  return record.recordType === 'url' && typeof record.data === 'string' ? record.data : undefined;
}

/** What the phone reads on an undamaged tag (SPEC-customers-v2, point 4: blank in the strict sense). */
function readOf(tag: Exclude<FakeTag, { kind: 'damaged' }>): CardContent {
  if (tag.kind === 'foreign') return { urls: [], blank: false };
  return tag.url === null ? { urls: [], blank: true } : { urls: [tag.url], blank: false };
}

/**
 * The E2E card reader and writer (SPEC-card-input, point 7). `window.__enjoyFakeCard(uid)` is the card
 * put on the phone: it hands `uid` to the service as a `'fake'` read in `'hex'` (same rules as the real
 * inputs), with what that fake tag holds, and completes a write waiting for a card. In place of
 * `NDEFReader.write()` the writer keeps the tags in memory (`uid → url | null`, `null` for a blank
 * card: new, or erased by `eraseCard`, SPEC-customers-v2 point 4): a card put on the phone
 * less than `IN_FIELD_MS` ago is still there, so the write happens at once and the card is read back
 * for the verification without another tap. Each successful write (`url: null` for an erase) is added to
 * `window.__enjoyFakeCardWrites`; `window.__enjoyFakeCardControl` makes the next write (or erase) fail
 * or the device unable to write. Installed by `main.tsx` only when `VITE_E2E === '1'`: never part of the
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

  /** What the phone gets from the tag `uid`: a read with its content, or no uid when damaged. */
  function present(uid: string) {
    // A tag never written is a new NTAG215: blank, like one erased by eraseCard.
    const tag = tags.get(uid) ?? BLANK_TAG;
    if (tag.kind === 'damaged') unreadable?.();
    else deliver?.(uid, 'hex', 'fake', readOf(tag));
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
        tags.set(uid, { kind: 'damaged' });
        write.reject(domError('NetworkError', 'The fake card was moved away while writing.'));
        return;
      case 'not-allowed':
        write.reject(domError('NotAllowedError', 'Writing is not allowed.'));
        return;
      case 'verify-failed':
        // Something else ends up on the card: the read back holds neither the link nor a blank card.
        tags.set(uid, { kind: 'foreign' });
        break;
      default:
        tags.set(uid, { kind: 'url', url: write.url });
        writes.push({ uid, url: write.url, at: now() });
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
      let reject!: (error: Error) => void;
      const done = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      const content = contentOf(message);
      const write: PendingWrite = { url: content ?? null, done, resolve, reject };
      if (content === undefined) {
        // Like Chrome for a message with no record; the app writes one link or one `empty` record.
        write.reject(new TypeError('The fake writer writes one link or a blank card.'));
        return done;
      }
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
