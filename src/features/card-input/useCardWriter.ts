import { useMemo } from 'react';
import { useCardReader } from './CardReaderProvider';
import { useCardReaderState } from './useCardRead';
import type { WriteUrl } from './webNfcWriter';

/**
 * Writes the link on a card (SPEC-card-input, points 5 and 9). `canWrite` is true only with Web NFC
 * `active` and an `NDEFReader` with `write()` (or the E2E fake writer): false on iPhone, with NFC off
 * or denied, and on the tablet, whose USB reader never writes. `writeUrl` refuses with `cannot-write`
 * whenever `canWrite` is false; while it runs, the reads go only to it, not to `useCardRead`.
 */
export function useCardWriter(): { canWrite: boolean; writeUrl: WriteUrl } {
  const reader = useCardReader();
  const { canWrite } = useCardReaderState();
  return useMemo(() => ({ canWrite, writeUrl: reader.writeUrl }), [canWrite, reader]);
}
