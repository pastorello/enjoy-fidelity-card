import { describe, expect, it } from 'vitest';
import { customerBackHomeState, customerBackState } from './customerBack';
import { homeSearchState, readHomeSearch } from './homeSearch';

describe('homeSearchState / readHomeSearch', () => {
  it('carries the typed text as it is, and nothing for a blank one', () => {
    expect(homeSearchState('rossi@exa')).toEqual({ q: 'rossi@exa' });
    expect(homeSearchState('  Rossi  Mari ')).toEqual({ q: '  Rossi  Mari ' });
    expect(homeSearchState('')).toBeNull();
    expect(homeSearchState('   ')).toBeNull();
  });

  it('reads the text back from a history state, or the empty text', () => {
    expect(readHomeSearch({ q: 'rossi@exa' })).toBe('rossi@exa');
    expect(readHomeSearch({ q: 'rossi', notice: 'x' })).toBe('rossi');
    for (const state of [null, undefined, 'rossi', {}, { q: 3 }, { backSearch: 'rossi' }]) {
      expect(readHomeSearch(state)).toBe('');
    }
  });
});

describe('customerBackHomeState', () => {
  it('returns to the search carried by the state, in the history state of the home', () => {
    expect(customerBackHomeState(customerBackState('rossi'))).toEqual({ q: 'rossi' });
    expect(customerBackHomeState(customerBackState('rossi@example.com'))).toEqual({
      q: 'rossi@example.com',
    });
    expect(
      customerBackHomeState({ ...customerBackState('Rossi Mari'), notice: 'Card associata.' }),
    ).toEqual({ q: 'Rossi Mari' });
  });

  it.each([null, undefined, 'rossi', {}, { backSearch: 3 }, { backSearch: '  ' }, { notice: 'x' }])(
    'any other state (%j) goes to the plain home',
    (state) => {
      expect(customerBackHomeState(state)).toBeNull();
    },
  );
});
