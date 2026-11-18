import { createContext, use, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { sortRewards } from './sortRewards';
import type { Reward, RewardsService } from './types';

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

export type RewardsState =
  | { status: 'loading' }
  | { status: 'done'; rewards: Reward[] }
  | { status: 'error'; error: unknown };

/** The state, and `reload` to ask the server again (after an error, or after a write). */
export type RewardsLoad = RewardsState & { reload: () => void };

/**
 * The whole catalogue (`listAll()`), loaded when the screen opens, in `sortRewards()` order.
 * `reload` after an error shows the loading state again; with a list already shown, the list
 * stays until the answer replaces it, and a failed reload keeps it (it was right a moment ago).
 * A newer load supersedes the answers still on their way; answers after unmount are dropped.
 */
export function useRewards(): RewardsLoad {
  const service = useRewardsService();
  const [state, setState] = useState<RewardsState>({ status: 'loading' });
  const latest = useRef(0);

  const load = useCallback(() => {
    latest.current += 1;
    const request = latest.current;
    service.listAll().then(
      (rewards) => {
        if (latest.current !== request) return;
        setState({ status: 'done', rewards: sortRewards(rewards) });
      },
      (error: unknown) => {
        if (latest.current !== request) return;
        setState((shown) => (shown.status === 'done' ? shown : { status: 'error', error }));
      },
    );
  }, [service]);

  useEffect(() => {
    load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  const reload = useCallback(() => {
    setState((shown) => (shown.status === 'error' ? { status: 'loading' } : shown));
    load();
  }, [load]);

  return { ...state, reload };
}
