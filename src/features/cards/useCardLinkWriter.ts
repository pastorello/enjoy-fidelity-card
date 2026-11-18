import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatest } from '../../lib/useLatest';
import { useCardWriter } from '../card-input/useCardWriter';
import type { CardWriteFailure, CardWriteStep } from '../card-input/webNfcWriter';
import { useAuth } from '../identity/AuthProvider';
import { cardLinkUrl } from './cardLinkUrl';
import { useCardsService } from './CardsServiceProvider';
import { ServerFaultError } from '../../lib/serverFault';
import { CardsError, NetworkError, type CardSummary } from './types';

/**
 * A confirmation that may not have arrived (no answer, a server fault): sending the same token again
 * is safe, the server confirms it once.
 */
export function isConfirmRetryable(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof ServerFaultError;
}

/** Why the link is not on the card: the write's own outcome, or no (good) answer from the server. */
export type CardLinkFailure =
  | {
      kind: 'write';
      reason: Exclude<CardWriteFailure, 'aborted' | 'cannot-write'>;
      otherUid?: string | undefined;
    }
  | { kind: 'issue'; error: unknown }
  | { kind: 'confirm'; error: unknown };

/** Where the writing of the link stands (SPEC-cards, point 8). */
export type CardLinkWriteState =
  /** Before the first answer: the first attempt starts as soon as the phone can write. */
  | { status: 'idle' }
  /** `issue_card_link` is on its way. */
  | { status: 'issuing' }
  /** `writeUrl` is running, at this step. */
  | { status: 'writing'; step: CardWriteStep }
  /** Written and verified: `confirm_card_link` is on its way. */
  | { status: 'confirming' }
  | { status: 'written'; card: CardSummary }
  | { status: 'failed'; failure: CardLinkFailure }
  /** The phone stopped being able to write (NFC off, permission revoked) while writing. */
  | { status: 'cannot-write' }
  /** «Salta» or «Più tardi»: nothing more happens. */
  | { status: 'stopped' };

export type CardLinkWriting = {
  state: CardLinkWriteState;
  /** False on iPhone, with NFC off or denied, on the tablet: the link cannot be written here. */
  canWrite: boolean;
  /** «Scrivi di nuovo il link»: from the start, with a new token (the pending one stops counting). */
  writeAgain: () => void;
  /**
   * «Scrivi comunque» after `unreadable`: from the start, writing even on a card whose content does
   * not read (`allowUnreadable`); the verification still needs the right uid.
   */
  writeAnyway: () => void;
  /**
   * «Riprova» after a confirmation without answer: `confirmLink` again with the same token, still in
   * memory, without a new issue nor a new write (the card already holds the link). Does nothing
   * when no confirmation is waiting.
   */
  retryConfirm: () => void;
  /** «Salta, lo scrivo più tardi» / «Più tardi»: aborts the write in progress through its signal. */
  stop: () => void;
};

type Options = {
  cardId: string;
  /** Canonical uid of the card: the only card the link may be written on. */
  uid: string;
  /** The link is written, verified and confirmed: the card as the server now has it. */
  onWritten?: ((card: CardSummary) => void) | undefined;
};

/**
 * Writes the link to the points on a card just associated (SPEC-cards, point 8): `issueLink` →
 * `writeUrl(cardLinkUrl(token), { expectedUid, signal })` → `confirmLink` with the same token. It
 * starts by itself once the phone can write. The token lives only in the closure of one attempt:
 * never in state, the DOM, storage or logs. Unmounting aborts the write in progress.
 */
export function useCardLinkWriter({ cardId, uid, onWritten }: Options): CardLinkWriting {
  const service = useCardsService();
  const { canWrite, writeUrl } = useCardWriter();
  const { reportNotEnabled } = useAuth();
  const [state, setState] = useState<CardLinkWriteState>({ status: 'idle' });
  // The attempt in progress: aborting it drops every answer it is still waiting for.
  const attempt = useRef<AbortController | null>(null);
  const written = useLatest(onWritten);

  // The confirmation to send again after no answer: a closure over the token, never state.
  const pendingConfirm = useRef<(() => void) | null>(null);

  // Set once the first attempt has started (by itself, see below).
  const started = useRef(false);
  useEffect(
    () => () => {
      attempt.current?.abort();
      // A remount (StrictMode in development) starts again instead of waiting on an aborted attempt.
      started.current = false;
    },
    [],
  );

  const fail = useCallback(
    (failure: CardLinkFailure) => {
      if (failure.kind !== 'write' && failure.error instanceof CardsError) {
        if (failure.error.kind === 'not_operator') void reportNotEnabled();
      }
      setState({ status: 'failed', failure });
    },
    [reportNotEnabled],
  );

  const confirm = useCallback(
    async function confirmToken(signal: AbortSignal, token: string) {
      pendingConfirm.current = null;
      setState({ status: 'confirming' });
      try {
        const card = await service.confirmLink(cardId, token);
        if (signal.aborted) return;
        setState({ status: 'written', card });
        written.current?.(card);
      } catch (error) {
        if (signal.aborted) return;
        // Idempotent on the server: the same token can be confirmed again (SPEC-cards, point 8.4).
        if (isConfirmRetryable(error)) {
          pendingConfirm.current = () => void confirmToken(signal, token);
        }
        fail({ kind: 'confirm', error });
      }
    },
    [service, cardId, fail, written],
  );

  const run = useCallback(
    async (signal: AbortSignal, allowUnreadable: boolean) => {
      let token: string;
      try {
        token = await service.issueLink(cardId);
      } catch (error) {
        if (!signal.aborted) fail({ kind: 'issue', error });
        return;
      }
      if (signal.aborted) return;
      const result = await writeUrl(cardLinkUrl(token), {
        expectedUid: uid,
        signal,
        allowUnreadable,
        onStep: (step) => {
          if (!signal.aborted) setState({ status: 'writing', step });
        },
      });
      if (signal.aborted) return;
      if (!result.ok) {
        if (result.reason === 'aborted') return;
        if (result.reason === 'cannot-write') {
          setState({ status: 'cannot-write' });
          return;
        }
        fail({ kind: 'write', reason: result.reason, otherUid: result.otherUid });
        return;
      }
      // The card holds the link and it was read back: the confirmation goes on even after «Salta».
      await confirm(signal, token);
    },
    [service, cardId, uid, writeUrl, fail, confirm],
  );

  const begin = useCallback(
    (allowUnreadable = false) => {
      attempt.current?.abort();
      pendingConfirm.current = null;
      const controller = new AbortController();
      attempt.current = controller;
      void run(controller.signal, allowUnreadable);
    },
    [run],
  );

  // The first attempt starts as soon as the phone can write; until its first answer the state stays
  // `idle`, which the section shows like `issuing`.
  useEffect(() => {
    if (!canWrite || started.current) return;
    started.current = true;
    begin();
  }, [canWrite, begin]);

  const writeAgain = useCallback(() => {
    started.current = true;
    setState({ status: 'issuing' });
    begin();
  }, [begin]);

  const writeAnyway = useCallback(() => {
    started.current = true;
    setState({ status: 'issuing' });
    begin(true);
  }, [begin]);

  const retryConfirm = useCallback(() => {
    pendingConfirm.current?.();
  }, []);

  const stop = useCallback(() => {
    attempt.current?.abort();
    attempt.current = null;
    // «Più tardi» after a confirmation without answer: the token is dropped, the link stays pending.
    pendingConfirm.current = null;
    setState({ status: 'stopped' });
  }, []);

  return { state, canWrite, writeAgain, writeAnyway, retryConfirm, stop };
}
