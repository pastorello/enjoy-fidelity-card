import { act } from '@testing-library/react';
import { vi } from 'vitest';

/** What the page asked of one observer: its options, what it watches, whether it was disconnected. */
export type FakeObserver = {
  readonly options: IntersectionObserverInit | undefined;
  readonly targets: readonly Element[];
  readonly disconnected: boolean;
};

/**
 * Installs a fake `IntersectionObserver` (jsdom has none) for the current test; remove it with
 * `vi.unstubAllGlobals()`. `enter()` tells every connected observer that its targets came into
 * view, as scrolling near the end of the list would; `observers` lists every one created, in order.
 */
export function installFakeIntersectionObserver() {
  const observers: FakeIntersectionObserver[] = [];

  class FakeIntersectionObserver implements IntersectionObserver, FakeObserver {
    readonly root = null;
    readonly rootMargin: string;
    readonly scrollMargin = '0px';
    readonly thresholds: readonly number[] = [0];
    readonly options: IntersectionObserverInit | undefined;
    targets: Element[] = [];
    disconnected = false;
    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = callback;
      this.options = options;
      this.rootMargin = options?.rootMargin ?? '0px';
      observers.push(this);
    }

    observe(target: Element) {
      this.targets.push(target);
    }

    unobserve(target: Element) {
      this.targets = this.targets.filter((item) => item !== target);
    }

    disconnect() {
      this.disconnected = true;
      this.targets = [];
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }

    /** Reports every target as intersecting. */
    enter() {
      if (this.disconnected || this.targets.length === 0) return;
      const entries = this.targets.map((target): IntersectionObserverEntry => {
        const box = target.getBoundingClientRect();
        return {
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: box,
          intersectionRect: box,
          rootBounds: null,
          time: 0,
        };
      });
      this.callback(entries, this);
    }
  }

  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

  return {
    observers: observers as readonly FakeObserver[],
    /** The targets of the observers still connected. */
    live(): Element[] {
      return observers.filter((item) => !item.disconnected).flatMap((item) => item.targets);
    },
    /** Every connected observer reports its targets as intersecting. */
    enter() {
      act(() => {
        for (const observer of observers) observer.enter();
      });
    },
  };
}
