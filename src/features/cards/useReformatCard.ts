import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatest } from '../../lib/useLatest';
import { useCardWriter } from '../card-input/useCardWriter';
import type { CardWriteFailure, CardWriteStep } from '../card-input/webNfcWriter';
import { useAuth } from '../identity/AuthProvider';
import { useUsbCardInput } from '../tablet-kiosk/useUsbCardInput';
import { useCardsService } from './CardsServiceProvider';
import { formatCardLabel } from './formatCard';
import { CardsError, type CardDetail } from './types';

/** Why the card was not reformatted: the erase's own outcome, or the release after it. */
export type ReformatFailure =
  | {
      kind: 'erase';
      reason: Exclude<CardWriteFailure, 'aborted' | 'cannot-write'>;
      /** With `wrong-card`: the card read instead, and whether `write()` had started on it. */
      otherUid?: string | undefined;
      mayHaveWritten?: boolean | undefined;
    }
  /** The card is empty and verified; `release_card` failed with `error`. */
  | { kind: 'release'; error: unknown };

/** Where «Riformatta la card» stands (SPEC-customers-v2, point 4, «Riformatta»). */
export type ReformatState =
  /** Nothing asked yet, or stopped with «Annulla» / «Lascia com'è». */
  | { status: 'idle' }
  /** The danger confirmation is open; nothing is written yet. */
  | { status: 'confirming' }
  /** `eraseCard` is running, at this step (`waiting-card` until its first step). */
  | { status: 'erasing'; step: CardWriteStep }
  /** Emptied and verified: `release_card` is on its way. */
  | { status: 'releasing' }
  | { status: 'failed'; failure: ReformatFailure }
  /** The phone stopped being able to write (NFC off, permission revoked) while erasing. */
  | { status: 'cannot-write' }
  /** Released: the uid is free again. */
  | { status: 'released' };

export type ReformatCard = ReformatState & {
  /** False on the tablet, iPhone, with NFC off or denied: the note takes the button's place. */
  canWrite: boolean;
  /** «Riformatta la card»: opens the confirmation. */
  ask: () => void;
  /** «Riformatta» in the confirmation: erases the card, then releases it. */
  confirm: () => void;
  /** «Riprova» after a failure: the release again (same operation_id) once the card is empty, else the erase. */
  retry: () => void;
  /** «Riformatta comunque» after `unreadable`: erases a card whose content does not read. */
  eraseAnyway: () => void;
  /** «Lascia com'è» / «Annulla»: stops the erase through its signal (not the release on its way). */
  cancel: () => void;
};

/** The one-time message of the home once the card is free. */
export function reformattedNotice(uid: string): string {
  return `Card ${formatCardLabel(uid)} riformattata: ora è libera.`;
}

/**
 * A release that may not have arrived, or not have been applied (no answer, a server fault,
 * anything unexpected): sending it again with the same operation_id is safe, the server applies it
 * once. Only the refusals that sending again would not change end the flow.
 */
export function isReleaseRetryable(error: unknown): boolean {
  if (!(error instanceof CardsError)) return true;
  return !['card_active', 'forbidden', 'card_not_found', 'not_operator'].includes(error.kind);
}

/**
 * «Riformatta la card» of `/card/:cardId` (SPEC-customers-v2, points 4 and 5): a danger confirmation,
 * then `eraseCard` (one `empty` record, verified by reading it back), and only then
 * `release_card(operation_id, card_id)`. The operation_id is generated at the tap of «Riformatta» and
 * kept until a definite answer: «Riprova» after a release without answer sends it again without the
 * card, and so does a new «Riformatta» after giving up (the server may have applied the first one).
 * Never written on the tablet, whose USB reader does not write. Unmounting aborts the erase.
 */
export function useReformatCard(card: CardDetail | null, onReleased: () => void): ReformatCard {
  const service = useCardsService();
  const writer = useCardWriter();
  const usb = useUsbCardInput();
  const canWrite = writer.canWrite && !usb;
  const { eraseCard } = writer;
  const { reportNotEnabled } = useAuth();
  const [state, setState] = useState<ReformatState>({ status: 'idle' });
  const attempt = useRef<AbortController | null>(null);
  const operationId = useRef<string | null>(null);
  // The card is empty and verified: «Riprova» sends the release again, not the erase.
  const emptied = useRef(false);
  const released = useLatest(onReleased);

  useEffect(
    () => () => {
      attempt.current?.abort();
    },
    [],
  );

  const release = useCallback(
    async (signal: AbortSignal, cardId: string, id: string) => {
      setState({ status: 'releasing' });
      try {
        await service.releaseCard(id, cardId);
      } catch (error) {
        if (signal.aborted) return;
        if (!isReleaseRetryable(error)) operationId.current = null;
        if (error instanceof CardsError && error.kind === 'not_operator') {
          setState({ status: 'idle' });
          void reportNotEnabled();
          return;
        }
        setState({ status: 'failed', failure: { kind: 'release', error } });
        return;
      }
      operationId.current = null;
      emptied.current = false;
      if (signal.aborted) return;
      setState({ status: 'released' });
      released.current();
    },
    [service, reportNotEnabled, released],
  );

  const run = useCallback(
    async (signal: AbortSignal, allowUnreadable: boolean) => {
      if (card === null) return;
      const id = operationId.current;
      if (id === null) return;
      if (emptied.current) {
        await release(signal, card.id, id);
        return;
      }
      setState({ status: 'erasing', step: 'waiting-card' });
      const result = await eraseCard({
        expectedUid: card.uid,
        signal,
        allowUnreadable,
        onStep: (step) => {
          if (!signal.aborted) setState({ status: 'erasing', step });
        },
      });
      if (signal.aborted) return;
      if (!result.ok) {
        if (result.reason === 'aborted') {
          setState({ status: 'idle' });
          return;
        }
        if (result.reason === 'cannot-write') {
          setState({ status: 'cannot-write' });
          return;
        }
        setState({
          status: 'failed',
          failure:
            result.reason === 'wrong-card'
              ? {
                  kind: 'erase',
                  reason: result.reason,
                  otherUid: result.otherUid,
                  mayHaveWritten: result.mayHaveWritten,
                }
              : { kind: 'erase', reason: result.reason },
        });
        return;
      }
      // Empty and read back: only now may the server unbind the card (criterion 9).
      emptied.current = true;
      await release(signal, card.id, id);
    },
    [card, eraseCard, release],
  );

  const begin = useCallback(
    (allowUnreadable: boolean) => {
      attempt.current?.abort();
      const controller = new AbortController();
      attempt.current = controller;
      void run(controller.signal, allowUnreadable);
    },
    [run],
  );

  const ask = useCallback(() => setState({ status: 'confirming' }), []);

  const confirm = useCallback(() => {
    if (card === null) return;
    // Kept from an attempt whose release has no definite answer: the server may have applied it.
    operationId.current ??= crypto.randomUUID();
    // A new tap of «Riformatta» erases the card again: it may have been read back elsewhere.
    emptied.current = false;
    begin(false);
  }, [card, begin]);

  const retry = useCallback(() => begin(false), [begin]);
  const eraseAnyway = useCallback(() => begin(true), [begin]);

  const cancel = useCallback(() => {
    attempt.current?.abort();
    attempt.current = null;
    setState({ status: 'idle' });
  }, []);

  return { ...state, canWrite, ask, confirm, retry, eraseAnyway, cancel };
}
