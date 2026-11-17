import { vi } from 'vitest';
import { SettingsLoadError } from '../features/settings/types';
import type {
  Settings,
  SettingsLoadErrorKind,
  SettingsService,
  UpdateSettingsResult,
} from '../features/settings/types';

/** The configuration written by the migration: 1 point per 1,00 €, confirm above 150,00 €. */
export const defaultSettings: Settings = {
  centsPerPoint: 100,
  confirmThresholdCents: 15000,
  usbUidFormat: 'hex',
  updatedAt: '2026-11-17T09:00:00.000Z',
};

type FakeOptions = {
  settings?: Settings;
  /** Outcomes of each `load()`, in order; the last one repeats. Default: always 'ok'. */
  loadResults?: ('ok' | SettingsLoadErrorKind)[];
  /** Outcomes of each `update()`, in order; the last one repeats. Default: always 'ok'. */
  updateResults?: UpdateSettingsResult['status'][];
};

/** Returns the programmed results one per call, repeating the last. */
function sequence<T>(results: readonly T[], fallback: T): () => T {
  let next = 0;
  return () => {
    const result = results[Math.min(next, results.length - 1)] ?? fallback;
    next += 1;
    return result;
  };
}

/**
 * In-memory SettingsService for component tests. A successful `update` changes what the next
 * `load` returns (the USB format stays as it is, like on the server); `changeElsewhere()`
 * simulates another admin saving from another phone. Both methods are `vi.fn`, so tests count
 * calls (double taps, "Riprova") with `toHaveBeenCalledTimes`.
 */
export function createFakeSettingsService({
  settings = defaultSettings,
  loadResults = [],
  updateResults = [],
}: FakeOptions = {}) {
  let stored = settings;
  let saves = 0;
  const nextLoad = sequence(loadResults, 'ok');
  const nextUpdate = sequence(updateResults, 'ok');

  const service = {
    load: vi.fn<SettingsService['load']>(() => {
      const outcome = nextLoad();
      if (outcome !== 'ok') return Promise.reject(new SettingsLoadError(outcome));
      return Promise.resolve(stored);
    }),
    update: vi.fn<SettingsService['update']>((input) => {
      const status = nextUpdate();
      if (status !== 'ok') return Promise.resolve({ status });
      saves += 1;
      stored = {
        ...stored,
        ...input,
        updatedAt: `2026-11-17T10:00:${String(saves).padStart(2, '0')}.000Z`,
      };
      return Promise.resolve({ status: 'ok', settings: stored });
    }),
  } satisfies SettingsService;

  return {
    service,
    /** The values the next successful `load()` returns. */
    current: () => stored,
    changeElsewhere(changes: Partial<Omit<Settings, 'updatedAt'>>) {
      saves += 1;
      stored = {
        ...stored,
        ...changes,
        updatedAt: `2026-11-17T11:00:${String(saves).padStart(2, '0')}.000Z`,
      };
    },
  };
}
