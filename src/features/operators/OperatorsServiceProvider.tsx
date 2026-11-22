import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import type { OperatorsService } from './types';

const OperatorsServiceContext = createContext<OperatorsService | null>(null);

/**
 * Supplies the OperatorsService, like KioskServiceProvider: `main.tsx` passes the Supabase
 * implementation, `renderApp` the fake.
 */
export function OperatorsServiceProvider({
  service,
  children,
}: {
  service: OperatorsService;
  children: ReactNode;
}) {
  return <OperatorsServiceContext value={service}>{children}</OperatorsServiceContext>;
}

export function useOperatorsService(): OperatorsService {
  const service = use(OperatorsServiceContext);
  if (!service)
    throw new Error('useOperatorsService must be used inside <OperatorsServiceProvider>');
  return service;
}
