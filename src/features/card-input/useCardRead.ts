import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CardRead, CardReaderState } from './cardReader';
import { useCardReader } from './CardReaderProvider';

/**
 * Receives the card reads while this consumer is on top of the stack (SPEC-card-input, point 5): the
 * last one activated (mounted with `enabled` not false, or switched from false to true). Unmounting or
 * disabling removes exactly this entry. The latest `onRead` is always used, without subscribing again.
 */
export function useCardRead(
  onRead: (read: CardRead) => void,
  { enabled = true }: { enabled?: boolean } = {},
): void {
  const reader = useCardReader();
  const latest = useRef(onRead);
  useEffect(() => {
    latest.current = onRead;
  });
  useEffect(
    () => (enabled ? reader.pushConsumer((read) => latest.current(read)) : undefined),
    [reader, enabled],
  );
}

/** The reader state (Web NFC status, USB reader) and `start()`, to call from a tap only. */
export function useCardReaderState(): CardReaderState & { start(): Promise<void> } {
  const reader = useCardReader();
  const subscribe = useCallback((listener: () => void) => reader.subscribe(listener), [reader]);
  const getState = useCallback(() => reader.getState(), [reader]);
  const state = useSyncExternalStore(subscribe, getState);
  const start = useCallback(() => reader.start(), [reader]);
  return useMemo(() => ({ ...state, start }), [state, start]);
}
