import { afterEach, describe, expect, it, vi } from 'vitest';
import { vibrate } from './vibrate';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('vibrate', () => {
  it('calls navigator.vibrate with the duration', () => {
    const spy = vi.fn<(pattern: VibratePattern) => boolean>(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: spy, configurable: true });
    vibrate(200);
    expect(spy).toHaveBeenCalledWith(200);
  });

  it('does nothing where the browser cannot vibrate', () => {
    expect(() => vibrate(200)).not.toThrow();
  });

  it('ignores a browser that refuses (no user gesture yet)', () => {
    Object.defineProperty(navigator, 'vibrate', {
      value: () => {
        throw new Error('blocked');
      },
      configurable: true,
    });
    expect(() => vibrate(200)).not.toThrow();
  });
});
