import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Settings, SettingsService } from './types';

export type SettingsState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; settings: Settings };

export type SettingsContextValue = SettingsState & { save: SettingsService['update'] };

const SettingsServiceContext = createContext<SettingsService | null>(null);
const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Supplies the SettingsService, like the service of AuthProvider: `main.tsx` passes the Supabase
 * implementation, `renderApp` the fake. Loading starts only in <SettingsProvider>.
 */
export function SettingsServiceProvider({
  service,
  children,
}: {
  service: SettingsService;
  children: ReactNode;
}) {
  return <SettingsServiceContext value={service}>{children}</SettingsServiceContext>;
}

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; settings: Settings };

/**
 * Holds the bar's configuration for the signed-in operator. Mounted by <RequireCashier>, so it loads
 * once per session; it loads again after a save and whenever the page becomes visible, so a phone
 * left open sees a ratio changed by another administrator.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const service = use(SettingsServiceContext);
  if (!service) throw new Error('SettingsProvider must be used inside <SettingsServiceProvider>');

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // The latest request started (load or save); an older one that answers later is ignored.
  const latest = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(
    (background: boolean) => {
      const request = ++latest.current;
      const current = () => mounted.current && request === latest.current;
      return service.load().then(
        (settings) => {
          if (current()) setState({ status: 'ready', settings });
        },
        () => {
          if (!current()) return;
          // A failed reload keeps the values already shown: they were valid a moment ago.
          setState((shown) =>
            background && shown.status === 'ready' ? shown : { status: 'error' },
          );
        },
      );
    },
    [service],
  );

  useEffect(() => {
    mounted.current = true;
    void load(false);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [load]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    void load(false);
  }, [load]);

  const save = useCallback<SettingsService['update']>(
    async (input) => {
      const result = await service.update(input);
      if (result.status !== 'ok' || !mounted.current) return result;
      // Show the server's values at once (newer than any reload still running), then reload.
      ++latest.current;
      setState({ status: 'ready', settings: result.settings });
      void load(true);
      return result;
    },
    [service, load],
  );

  const value = useMemo<SettingsContextValue>(
    () => (state.status === 'error' ? { status: 'error', retry, save } : { ...state, save }),
    [state, retry, save],
  );
  return <SettingsContext value={value}>{children}</SettingsContext>;
}

/** The bar's configuration. Only for screens behind <RequireCashier>. */
export function useSettings(): SettingsContextValue {
  const value = use(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}
