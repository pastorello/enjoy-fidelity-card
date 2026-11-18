import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import type { KioskService } from './types';

const KioskServiceContext = createContext<KioskService | null>(null);

/**
 * Supplies the KioskService, like LedgerServiceProvider: `main.tsx` passes the Supabase
 * implementation, `renderApp` the fake.
 */
export function KioskServiceProvider({
  service,
  children,
}: {
  service: KioskService;
  children: ReactNode;
}) {
  return <KioskServiceContext value={service}>{children}</KioskServiceContext>;
}

export function useKioskService(): KioskService {
  const service = use(KioskServiceContext);
  if (!service) throw new Error('useKioskService must be used inside <KioskServiceProvider>');
  return service;
}
