import { useMemo } from 'react';
import { useCardReader } from './CardReaderProvider';
import { useCardReaderState } from './useCardRead';
import type { EraseCard, WriteUrl } from './webNfcWriter';

/**
 * Writes the link on a card (SPEC-card-input, points 5 and 9), or erases it (SPEC-customers-v2,
 * point 4). `canWrite` is true only with Web NFC `active` and an `NDEFReader` with `write()` (or the
 * E2E fake writer): false on iPhone, with NFC off or denied, and on the tablet, whose USB reader
 * never writes. `writeUrl` and `eraseCard` refuse with `cannot-write` whenever `canWrite` is false and
 * share one exclusive session: while either runs, the reads go only to it, not to `useCardRead`.
 */
export function useCardWriter(): { canWrite: boolean; writeUrl: WriteUrl; eraseCard: EraseCard } {
  const reader = useCardReader();
  const { canWrite } = useCardReaderState();
  return useMemo(
    () => ({ canWrite, writeUrl: reader.writeUrl, eraseCard: reader.eraseCard }),
    [canWrite, reader],
  );
}
