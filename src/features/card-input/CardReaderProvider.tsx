import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import type { CardReader } from './cardReader';

const CardReaderContext = createContext<CardReader | null>(null);

/**
 * Supplies the single card-reading service (SPEC-card-input, point 2): `main.tsx` passes the one with
 * the real adapters, `renderApp` one with fakes. It starts nothing by itself: reading begins only when
 * `CardReaderSession`, inside `RequireCashier`, calls `activate()`.
 */
export function CardReaderProvider({
  reader,
  children,
}: {
  reader: CardReader;
  children: ReactNode;
}) {
  return <CardReaderContext value={reader}>{children}</CardReaderContext>;
}

export function useCardReader(): CardReader {
  const reader = use(CardReaderContext);
  if (!reader) throw new Error('useCardReader must be used inside <CardReaderProvider>');
  return reader;
}
