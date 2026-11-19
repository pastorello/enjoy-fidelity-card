import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TABLET_LAYOUT_QUERY, useTabletLayout } from './useTabletLayout';

/** The hook only re-reads `matches` on a change, so the fake event carries nothing. */
type Listener = () => void;

/** A matchMedia whose single query can be switched on and off, as rotating or resizing would. */
function installFakeMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<Listener>();
  const queries: string[] = [];
  const matchMedia = (query: string) => {
    queries.push(query);
    return {
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_type: 'change', listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: 'change', listener: Listener) => listeners.delete(listener),
    };
  };
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    queries,
    listeners,
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTabletLayout', () => {
  it('watches the tablet query of the spec', () => {
    expect(TABLET_LAYOUT_QUERY).toBe('(min-width: 1024px) and (min-height: 600px)');
    const media = installFakeMatchMedia(false);
    renderHook(() => useTabletLayout());
    expect(media.queries).toContain(TABLET_LAYOUT_QUERY);
  });

  it('is false on the phone and true on the 1280×800 tablet', () => {
    installFakeMatchMedia(false);
    expect(renderHook(() => useTabletLayout()).result.current).toBe(false);
    installFakeMatchMedia(true);
    expect(renderHook(() => useTabletLayout()).result.current).toBe(true);
  });

  it('follows the query when it changes, and stops listening on unmount', () => {
    const media = installFakeMatchMedia(false);
    const { result, unmount } = renderHook(() => useTabletLayout());
    act(() => media.set(true));
    expect(result.current).toBe(true);
    act(() => media.set(false));
    expect(result.current).toBe(false);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('falls back to the phone layout where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(renderHook(() => useTabletLayout()).result.current).toBe(false);
  });
});
