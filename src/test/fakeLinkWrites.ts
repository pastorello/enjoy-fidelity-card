import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { CardReader } from '../features/card-input/cardReader';
import type {
  CardWriteResult,
  CardWriteStep,
  WriteUrlOptions,
} from '../features/card-input/webNfcWriter';

/** One `writeUrl` call, ended by the test with `finish` (or by its signal). */
export type LinkWriteCall = {
  url: string;
  options: WriteUrlOptions;
  step: (step: CardWriteStep) => void;
  finish: (result: CardWriteResult) => Promise<void>;
};

/**
 * Makes the reader's `writeUrl` wait for the test: every call is pushed to the returned list and
 * resolves with `finish`, or with `aborted` when its signal aborts (as the real writer does).
 */
export function driveLinkWrites(reader: CardReader): LinkWriteCall[] {
  const writes: LinkWriteCall[] = [];
  vi.spyOn(reader, 'writeUrl').mockImplementation(
    (url, options) =>
      new Promise<CardWriteResult>((resolve) => {
        writes.push({
          url,
          options,
          step: (step) => act(() => options.onStep?.(step)),
          finish: (result) =>
            act(async () => {
              resolve(result);
              await Promise.resolve();
            }),
        });
        options.signal?.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted' }));
      }),
  );
  return writes;
}
