import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import type { RewardsService } from './types';

const RewardsServiceContext = createContext<RewardsService | null>(null);

/**
 * Supplies the RewardsService, like CustomerServiceProvider: `main.tsx` passes the Supabase
 * implementation, `renderApp` the fake.
 */
export function RewardsServiceProvider({
  service,
  children,
}: {
  service: RewardsService;
  children: ReactNode;
}) {
  return <RewardsServiceContext value={service}>{children}</RewardsServiceContext>;
}

export function useRewardsService(): RewardsService {
  const service = use(RewardsServiceContext);
  if (!service) throw new Error('useRewardsService must be used inside <RewardsServiceProvider>');
  return service;
}
