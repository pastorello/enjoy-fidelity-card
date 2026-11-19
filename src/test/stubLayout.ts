import { vi } from 'vitest';

/**
 * A matchMedia that answers every query with `matches`: true is the 1280×800 till tablet
 * (`useTabletLayout`), false the 390×844 phone. Undo with `vi.unstubAllGlobals()`.
 */
export function stubLayout(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
