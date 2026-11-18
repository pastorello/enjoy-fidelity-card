import { describe, expect, it, vi } from 'vitest';
import { isPublicCardPath, setUpServiceWorker } from './registerServiceWorker';

type Listener = (event: Event) => void;

function fakeWindow(pathname: string, options: { serviceWorker?: boolean } = {}) {
  const listeners = new Map<string, Listener[]>();
  const register = vi.fn<(url: string, options: RegistrationOptions) => Promise<unknown>>(() =>
    Promise.resolve(),
  );
  const win = {
    location: { pathname },
    navigator: options.serviceWorker === false ? {} : { serviceWorker: { register } },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  const fire = (type: string, event: Event = new Event(type, { cancelable: true })) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  };
  return { win, register, fire, listeners };
}

describe('isPublicCardPath', () => {
  it.each(['/s/Zq3_x-9KpL2mN8vR4tY6wA', '/s/', '/s'])('is true for %s', (path) => {
    expect(isPublicCardPath(path)).toBe(true);
  });

  it.each(['/', '/clienti/abc', '/spesa', '/settings', '/sx', '/s-x/abc'])(
    'is false for %s',
    (path) => {
      expect(isPublicCardPath(path)).toBe(false);
    },
  );
});

describe('setUpServiceWorker', () => {
  it('registers /sw.js with scope / after load on the operator pages', () => {
    const { win, register, fire } = fakeWindow('/clienti/abc');
    setUpServiceWorker(win);
    expect(register).not.toHaveBeenCalled();
    fire('load');
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/' });
  });

  it('never registers the service worker on the public points page', () => {
    const { win, register, fire, listeners } = fakeWindow('/s/Zq3_x-9KpL2mN8vR4tY6wA');
    setUpServiceWorker(win);
    fire('load');
    expect(register).not.toHaveBeenCalled();
    expect(listeners.has('load')).toBe(false);
  });

  it('cancels the install prompt on the public points page', () => {
    const { win, fire } = fakeWindow('/s/Zq3_x-9KpL2mN8vR4tY6wA');
    setUpServiceWorker(win);
    expect(fire('beforeinstallprompt').defaultPrevented).toBe(true);
  });

  it('leaves the install prompt alone on the operator pages', () => {
    const { win, fire } = fakeWindow('/');
    setUpServiceWorker(win);
    expect(fire('beforeinstallprompt').defaultPrevented).toBe(false);
  });

  it('does nothing where the browser has no service workers', () => {
    const { win, fire } = fakeWindow('/', { serviceWorker: false });
    expect(() => {
      setUpServiceWorker(win);
      fire('load');
    }).not.toThrow();
  });

  it('a failed registration does not throw (no offline mode, the app works without it)', async () => {
    const { win, register, fire } = fakeWindow('/');
    register.mockReturnValueOnce(Promise.reject(new Error('blocked')));
    setUpServiceWorker(win);
    fire('load');
    await Promise.resolve();
    expect(register).toHaveBeenCalledOnce();
  });
});
