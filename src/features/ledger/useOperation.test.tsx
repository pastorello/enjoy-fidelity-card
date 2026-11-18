import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { LedgerError } from './types';
import { useOperation } from './useOperation';

/** A `run` whose answers the test settles by hand, one per call. */
function controlledRun() {
  const calls: { id: string; resolve: (value: string) => void; reject: (e: unknown) => void }[] =
    [];
  const run = vi.fn<(id: string) => Promise<string>>(
    (id: string) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ id, resolve, reject });
      }),
  );
  return { run, calls };
}

let uuid = 0;
beforeEach(() => {
  uuid = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () =>
      `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useOperation', () => {
  it('starts idle and calls nothing', () => {
    const { run } = controlledRun();
    const { result } = renderHook(() => useOperation(run));
    expect(result.current.status).toBe('idle');
    expect(run).not.toHaveBeenCalled();
  });

  it('a double submit in the same tick makes one call, busy until the answer', async () => {
    const { run, calls } = controlledRun();
    const { result } = renderHook(() => useOperation(run));
    act(() => {
      void result.current.submit();
      void result.current.submit();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('busy');
    act(() => {
      void result.current.submit();
      result.current.retry();
    });
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => calls[0]!.resolve('ok'));
    expect(result.current).toMatchObject({ status: 'done', result: 'ok' });
  });

  it('retry after a network error sends the same operation id, once', async () => {
    const { run, calls } = controlledRun();
    const { result } = renderHook(() => useOperation(run));
    act(() => void result.current.submit());
    await act(async () => calls[0]!.reject(new LedgerError('network')));
    expect(result.current).toMatchObject({ status: 'error', retryable: true });
    expect(result.current.status === 'error' && result.current.error).toBeInstanceOf(LedgerError);

    act(() => {
      result.current.retry();
      result.current.retry();
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(calls[1]!.id).toBe(calls[0]!.id);
    await act(async () => calls[1]!.resolve('ok'));
    expect(result.current).toMatchObject({ status: 'done', result: 'ok' });
  });

  it.each([
    ['unknown', new LedgerError('unknown')],
    ['a server fault', new ServerFaultError('unavailable')],
    ['an unexpected error', new Error('boom')],
  ])('keeps the id after %s: the outcome is uncertain', async (_name, error) => {
    const { run, calls } = controlledRun();
    const { result } = renderHook(() => useOperation(run));
    act(() => void result.current.submit());
    await act(async () => calls[0]!.reject(error));
    expect(result.current).toMatchObject({ status: 'error', retryable: true, error });
    act(() => result.current.retry());
    expect(calls[1]!.id).toBe(calls[0]!.id);
  });

  it('a submit while an uncertain id is kept resends that id', async () => {
    const { run, calls } = controlledRun();
    const { result } = renderHook(() => useOperation(run));
    act(() => void result.current.submit());
    await act(async () => calls[0]!.reject(new LedgerError('network')));
    act(() => void result.current.submit());
    expect(calls[1]!.id).toBe(calls[0]!.id);
  });

  it('a new id after a success', async () => {
    const { run, calls } = controlledRun();
    const { result } = renderHook(() => useOperation(run));
    act(() => void result.current.submit());
    await act(async () => calls[0]!.resolve('first'));
    act(() => void result.current.submit());
    expect(run).toHaveBeenCalledTimes(2);
    expect(calls[1]!.id).not.toBe(calls[0]!.id);
  });

  it.each([
    'insufficient-balance',
    'reward-unavailable',
    'invalid',
    'conflict',
    'forbidden',
  ] as const)(
    'a definitive refusal (%s) consumes the id: retry does nothing, submit takes a new one',
    async (kind) => {
      const { run, calls } = controlledRun();
      const { result } = renderHook(() => useOperation(run));
      act(() => void result.current.submit());
      await act(async () => calls[0]!.reject(new LedgerError(kind)));
      expect(result.current).toMatchObject({ status: 'error', retryable: false });
      act(() => result.current.retry());
      expect(run).toHaveBeenCalledTimes(1);
      act(() => void result.current.submit());
      expect(run).toHaveBeenCalledTimes(2);
      expect(calls[1]!.id).not.toBe(calls[0]!.id);
    },
  );

  it('reset discards the id and goes back to idle', async () => {
    const { run, calls } = controlledRun();
    const { result } = renderHook(() => useOperation(run));
    act(() => void result.current.submit());
    await act(async () => calls[0]!.reject(new LedgerError('network')));
    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
    act(() => result.current.retry());
    expect(run).toHaveBeenCalledTimes(1);
    act(() => void result.current.submit());
    expect(calls[1]!.id).not.toBe(calls[0]!.id);
  });

  it('an answer that arrives after reset is dropped', async () => {
    const { run, calls } = controlledRun();
    const { result } = renderHook(() => useOperation(run));
    act(() => void result.current.submit());
    act(() => result.current.reset());
    await act(async () => calls[0]!.resolve('late'));
    expect(result.current.status).toBe('idle');
    act(() => void result.current.submit());
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never resends on its own after a network error', async () => {
    vi.useFakeTimers();
    const { run, calls } = controlledRun();
    const { result } = renderHook(() => useOperation(run));
    act(() => void result.current.submit());
    await act(async () => calls[0]!.reject(new LedgerError('network')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    window.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
  });

  it('keeps the operation id in memory only', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { run, calls } = controlledRun();
    const { result } = renderHook(() => useOperation(run));
    act(() => void result.current.submit());
    await act(async () => calls[0]!.reject(new LedgerError('network')));
    act(() => result.current.retry());
    await act(async () => calls[1]!.resolve('ok'));
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('uses the latest run passed to the hook', async () => {
    const first = vi.fn<(id: string) => Promise<string>>(() => Promise.resolve('first'));
    const second = vi.fn<(id: string) => Promise<string>>(() => Promise.resolve('second'));
    const { result, rerender } = renderHook(({ run }) => useOperation(run), {
      initialProps: { run: first },
    });
    rerender({ run: second });
    await act(async () => result.current.submit());
    expect(first).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ status: 'done', result: 'second' });
  });
});
