import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import type { LedgerService } from './types';

const LedgerServiceContext = createContext<LedgerService | null>(null);

/**
 * Supplies the LedgerService, like CardsServiceProvider: `main.tsx` passes the Supabase
 * implementation, `renderApp` the fake.
 */
export function LedgerServiceProvider({
  service,
  children,
}: {
  service: LedgerService;
  children: ReactNode;
}) {
  return <LedgerServiceContext value={service}>{children}</LedgerServiceContext>;
}

export function useLedgerService(): LedgerService {
  const service = use(LedgerServiceContext);
  if (!service) throw new Error('useLedgerService must be used inside <LedgerServiceProvider>');
  return service;
}
