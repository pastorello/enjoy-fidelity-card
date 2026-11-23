import type { CardContent, CardRead, CardReader } from './cardReader';
import { normalizeUid } from './normalizeUid';
import type { WebNfcApi } from './webNfcAdapter';

/** A read of the expected card younger than this means it is still on the phone: write at once. */
export const IN_FIELD_MS = 1500;
/** Longest link written: about 210 bytes of NDEF on an NTAG215 with 504 usable bytes. */
export const MAX_URL_LENGTH = 200;
/** Time for the card to be recognized and written (steps 1 and 2). */
export const WRITE_TIMEOUT_MS = 15_000;
/** Time for the card to be read back with the link (step 3), from `write()` resolving. */
export const VERIFY_TIMEOUT_MS = 15_000;
/** Length of the vibration on success, the same as a read delivered to a consumer. */
const VIBRATION_MS = 80;

export type CardWriteStep = 'waiting-card' | 'writing' | 'verifying';
export type CardWriteFailure =
  | 'cannot-write'
  | 'busy'
  | 'timeout'
  | 'wrong-card'
  | 'io'
  | 'not-allowed'
  | 'verify-failed'
  | 'unreadable'
  | 'aborted';
/**
 * `otherUid` is the card read instead of the expected one. `mayHaveWritten` is false when it was read
 * before `write()` started (nothing written), true from then on: Chrome writes the first tag in the
 * field, so that card may now hold what was meant for the expected one (SPEC-customers-v2, point 4).
 */
export type CardWriteResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-card'; otherUid: string; mayHaveWritten: boolean }
  | { ok: false; reason: Exclude<CardWriteFailure, 'wrong-card'> };

export type WriteUrlOptions = {
  expectedUid: string;
  signal?: AbortSignal | undefined;
  allowUnreadable?: boolean | undefined;
  onStep?: ((step: CardWriteStep) => void) | undefined;
};
export type WriteUrl = (url: string, options: WriteUrlOptions) => Promise<CardWriteResult>;
export type EraseCard = (options: WriteUrlOptions) => Promise<CardWriteResult>;

export type WebNfcWriterOptions = {
  api: Pick<WebNfcApi, 'createWriter'>;
  reader: Pick<CardReader, 'openWriteSession'>;
  now: () => number;
  /** False where writing is impossible (no Web NFC write, scan not active, USB reader only). */
  canWrite: () => boolean;
  /** `navigator.vibrate` bound to navigator, when the browser has it. */
  vibrate?: ((ms: number) => unknown) | undefined;
};

export type WebNfcWriter = { writeUrl: WriteUrl; eraseCard: EraseCard };

/**
 * What one write puts on the card and how its verification reads the card back: `written` for the
 * expected card, which must hold exactly what was written; `landedOn` for another card read during
 * the verification, true when it holds it too (it was written instead of the expected one).
 */
type WriteJob = {
  message: NDEFMessageInit;
  written: (content: CardContent) => boolean;
  landedOn: (content: CardContent) => boolean;
};

/** A blank card (strict: no record or only `empty` ones), the expected one or another one. */
function blank(content: CardContent): boolean {
  return content.blank;
}

/** A programming error, not an outcome: the caller (`cards`) knows the card. */
function checkUid(expectedUid: string): string {
  const uid = normalizeUid(expectedUid, 'hex');
  if (uid === null) throw new TypeError('The expected card uid is not valid.');
  return uid;
}

/** Programming errors, not outcomes: the caller (`cards`) builds the link and knows the card. */
function checkArguments(url: string, expectedUid: string): string {
  if (url.length > MAX_URL_LENGTH) {
    throw new TypeError(`The link is longer than ${MAX_URL_LENGTH} characters.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError('The link is not an absolute URL.');
  }
  if (parsed.protocol !== 'https:' || url.trim() !== url) {
    throw new TypeError('The link must be an https URL with no surrounding spaces.');
  }
  return checkUid(expectedUid);
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
}

/**
 * What a failed `write()` means. NetworkError (card moved away, or locked read-only by someone else),
 * NotReadableError and NotSupportedError (not an NDEF tag) are all `io`; anything unexpected too, so a
 * write is never reported as done.
 */
function failureForWriteError(error: unknown): 'not-allowed' | 'io' {
  return errorName(error) === 'NotAllowedError' ? 'not-allowed' : 'io';
}

/** A card on the phone: the USB reader of the tablet reads cards but is never where Web NFC writes. */
function onPhone(read: CardRead): boolean {
  return read.source !== 'usb';
}

/**
 * Writes the link on a card (SPEC-card-input, point 9), or a blank card (SPEC-customers-v2, point 4):
 * only on the expected card, recognized on the phone, with exactly one record (`url`, or `empty`) and
 * never `makeReadOnly()`. Both share one engine: the same steps, times and outcomes. While writing,
 * the service hands the reads to the writer only. Never retries by itself, never logs or keeps the
 * link (it holds a customer's token) nor the uids.
 */
export function createWebNfcWriter({
  api,
  reader,
  now,
  canWrite,
  vibrate,
}: WebNfcWriterOptions): WebNfcWriter {
  let busy = false;

  function run(job: WriteJob, expectedUid: string, options: WriteUrlOptions) {
    return new Promise<CardWriteResult>((resolve) => {
      const { signal, onStep, allowUnreadable = false } = options;
      // Aborts the running write() when the write ends for any other reason.
      const writeControl = new AbortController();
      let step: CardWriteStep | null = null;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      function startTimer(ms: number) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          finish({ ok: false, reason: 'timeout' });
        }, ms);
      }

      function finish(result: CardWriteResult) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        writeControl.abort();
        session.close();
        signal?.removeEventListener('abort', onAbort);
        busy = false;
        resolve(result);
      }

      function onAbort() {
        finish({ ok: false, reason: 'aborted' });
      }

      function enter(next: CardWriteStep) {
        step = next;
        try {
          onStep?.(next);
        } catch (error) {
          // A caller's bug must not leave the session open (no screen would get reads again):
          // report it as an uncaught error and go on.
          queueMicrotask(() => {
            throw error;
          });
        }
      }

      function startWrite() {
        enter('writing');
        let written: Promise<void>;
        try {
          // Always one record and nothing else, replacing whatever the card holds.
          written = api
            .createWriter()
            .write(job.message, { overwrite: true, signal: writeControl.signal });
        } catch (error) {
          finish({ ok: false, reason: failureForWriteError(error) });
          return;
        }
        written.then(
          () => {
            if (settled) return;
            // The card counts as written only once it is read back the same (verification),
            // which gets its own time.
            startTimer(VERIFY_TIMEOUT_MS);
            enter('verifying');
          },
          (error: unknown) => {
            finish({ ok: false, reason: failureForWriteError(error) });
          },
        );
      }

      function succeed() {
        try {
          vibrate?.(VIBRATION_MS);
        } catch {
          // The browser may refuse to vibrate: the link is written all the same.
        }
        finish({ ok: true });
      }

      function wrongCard(otherUid: string, mayHaveWritten: boolean) {
        finish({ ok: false, reason: 'wrong-card', otherUid, mayHaveWritten });
      }

      function onRead(read: CardRead, content: CardContent) {
        if (settled || !onPhone(read)) return;
        const expected = read.uid === expectedUid;
        switch (step) {
          case 'waiting-card':
            // Nothing written yet: the other card is untouched.
            if (expected) startWrite();
            else wrongCard(read.uid, false);
            return;
          case 'writing':
            // write() writes the first tag in the field, whichever it is: another card read now may
            // already hold what was written. The expected card read now is not a verification yet.
            if (!expected) wrongCard(read.uid, true);
            return;
          case 'verifying':
            if (expected) {
              if (job.written(content)) succeed();
              else finish({ ok: false, reason: 'verify-failed' });
            } else if (job.landedOn(content)) {
              // write() may have resolved on that card, read only now: it was written instead.
              wrongCard(read.uid, true);
            }
            // Another card that does not hold it was not written by us: ignored.
            return;
          default:
            return;
        }
      }

      // A damaged tag gives no uid: while waiting it is `unreadable`, unless the operator confirmed
      // it is the right card (`allowUnreadable`), the only way to repair one. Later it is ignored.
      function onUnreadable() {
        if (settled || step !== 'waiting-card') return;
        if (allowUnreadable) startWrite();
        else finish({ ok: false, reason: 'unreadable' });
      }

      const session = reader.openWriteSession(onRead, { onUnreadable, onInterrupt: onAbort });
      signal?.addEventListener('abort', onAbort);
      startTimer(WRITE_TIMEOUT_MS);
      enter('waiting-card');
      if (settled) return; // the caller aborted from onStep

      // Web NFC writes the first tag in the field: write at once only if the expected card was the
      // last one read, on the phone, a moment ago (the card just read to associate it, still there).
      const last = session.lastRead;
      if (
        last !== null &&
        onPhone(last) &&
        last.uid === expectedUid &&
        now() - last.at < IN_FIELD_MS
      ) {
        startWrite();
      }
    });
  }

  async function start(
    job: WriteJob,
    expectedUid: string,
    options: WriteUrlOptions,
  ): Promise<CardWriteResult> {
    if (!canWrite()) return { ok: false, reason: 'cannot-write' };
    if (busy) return { ok: false, reason: 'busy' };
    if (options.signal?.aborted === true) return { ok: false, reason: 'aborted' };
    busy = true;
    try {
      return await run(job, expectedUid, options);
    } catch (error) {
      busy = false;
      throw error;
    }
  }

  return {
    async writeUrl(url, options) {
      const expectedUid = checkArguments(url, options.expectedUid);
      const holdsLink = (content: CardContent) => content.urls.includes(url);
      return await start(
        {
          message: { records: [{ recordType: 'url', data: url }] },
          written: holdsLink,
          landedOn: holdsLink,
        },
        expectedUid,
        options,
      );
    },
    async eraseCard(options) {
      const expectedUid = checkUid(options.expectedUid);
      // Web NFC cannot format a tag and rejects a message with no record: one `empty` record (TNF 0)
      // is what Chrome reports for a new NTAG215. Never makeReadOnly(): the card stays writable.
      return await start(
        { message: { records: [{ recordType: 'empty' }] }, written: blank, landedOn: blank },
        expectedUid,
        options,
      );
    },
  };
}
