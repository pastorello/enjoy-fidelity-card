import { describe, expect, it } from 'vitest';
import { newCustomerCardState, readNewCustomerCard } from './newCustomerCardState';

describe('newCustomerCardState', () => {
  it('carries the uid in a state readNewCustomerCard reads back', () => {
    expect(newCustomerCardState('04A1B2C3D4E5F6')).toEqual({ card: '04A1B2C3D4E5F6' });
    expect(readNewCustomerCard(newCustomerCardState('04A1B2C3D4E5F6'))).toBe('04A1B2C3D4E5F6');
  });

  it.each([null, undefined, 'card', 4, {}, { card: 4 }, { card: null }, { q: 'rossi' }])(
    'reads no card from %j',
    (state) => {
      expect(readNewCustomerCard(state)).toBeNull();
    },
  );
});
