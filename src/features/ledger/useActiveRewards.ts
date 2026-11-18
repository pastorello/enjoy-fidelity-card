import { useCallback, useEffect, useRef, useState } from 'react';
import { useRewardsService } from '../rewards/RewardsServiceProvider';
import { sortRewards } from '../rewards/sortRewards';
import type { Reward } from '../rewards/types';

export type ActiveRewardsState =
  | { status: 'loading' }
  | { status: 'done'; rewards: Reward[] }
  | { status: 'error'; error: unknown };

export type ActiveRewardsLoad = ActiveRewardsState & { reload: () => void };

/**
 * The catalog shown at the till (`listActive()`, in `sortRewards()` order; SPEC-ledger point 5).
 * `reload` after an error shows the loading state again; with a list already shown (after a
 * `reward-unavailable` refusal) the list stays until the answer replaces it, and a failed reload
 * keeps it. A newer load supersedes the answers still on their way; answers after unmount are
 * dropped.
 */
export function useActiveRewards(): ActiveRewardsLoad {
  const service = useRewardsService();
  const [state, setState] = useState<ActiveRewardsState>({ status: 'loading' });
  const latest = useRef(0);

  const load = useCallback(() => {
    latest.current += 1;
    const request = latest.current;
    service.listActive().then(
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
