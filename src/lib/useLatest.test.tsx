import { describe, expect, it } from 'vitest';
import { renderHookThenFire } from '../test/fireAfterCommit';
import { useLatest } from './useLatest';

describe('useLatest', () => {
  it('holds the value of the first render', () => {
    const hosted = renderHookThenFire(({ value }) => useLatest(value), { value: 'prima' });
    expect(hosted.result().current).toBe('prima');
  });

  it('holds the value of the last commit already in its layout phase, before useEffect runs', () => {
    const hosted = renderHookThenFire(({ value }) => useLatest(value), { value: 'prima' });
    let seen: string | null = null;
    hosted.rerenderAndFire({ value: 'dopo' }, (latest) => {
      seen = latest.current;
    });
    expect(seen).toBe('dopo');
  });
});
