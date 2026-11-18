import { describe, expect, it } from 'vitest';
import { customerBackState, customerBackTo } from './customerBack';

describe('customerBackTo', () => {
  it('returns to the search carried by the state', () => {
    expect(customerBackTo(customerBackState('rossi'))).toBe('/?q=rossi');
    expect(customerBackTo(customerBackState('Rossi Mari'))).toBe('/?q=Rossi+Mari');
    expect(customerBackTo(customerBackState('a&b=c'))).toBe('/?q=a%26b%3Dc');
  });

  it.each([null, undefined, 'rossi', {}, { backSearch: 3 }, { backSearch: '  ' }, { notice: 'x' }])(
    'any other state (%j) goes to the plain home',
    (state) => {
      expect(customerBackTo(state)).toBe('/');
    },
  );
});
