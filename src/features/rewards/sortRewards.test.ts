import { describe, expect, it } from 'vitest';
import { sortRewards } from './sortRewards';
import type { Reward } from './types';

function reward(name: string, points: number, active = true): Reward {
  return { id: `id-${name}`, name, points, active };
}

describe('sortRewards', () => {
  it('lists the active rewards by points, then the inactive ones (the wireframe order)', () => {
    const rewards = [
      reward('Aperitivo', 200),
      reward('Dolce del giorno', 120, false),
      reward('Colazione per due', 180),
      reward('Caffè', 50),
      reward('Cornetto e cappuccino', 100),
    ];

    expect(sortRewards(rewards).map((r) => r.name)).toEqual([
      'Caffè',
      'Cornetto e cappuccino',
      'Colazione per due',
      'Aperitivo',
      'Dolce del giorno',
    ]);
  });

  it('orders the inactive rewards by points too', () => {
    const rewards = [reward('Torta', 300, false), reward('Biscotto', 20, false), reward('Tè', 40)];

    expect(sortRewards(rewards).map((r) => r.name)).toEqual(['Tè', 'Biscotto', 'Torta']);
  });

  it('breaks a tie on points by name, in Italian collation', () => {
    const rewards = [reward('spremuta', 80), reward('Caffè', 80), reward('Cappuccino', 80)];

    expect(sortRewards(rewards).map((r) => r.name)).toEqual(['Caffè', 'Cappuccino', 'spremuta']);
  });

  it('places an accented name where an Italian reader expects it', () => {
    // By code units 'è' sorts after every ASCII letter; in Italian it sorts with 'e'.
    const rewards = [reward('Caffo', 50), reward('Caffè', 50)];

    expect(sortRewards(rewards).map((r) => r.name)).toEqual(['Caffè', 'Caffo']);
  });

  it('does not change the array it receives', () => {
    const rewards = [reward('Aperitivo', 200), reward('Caffè', 50)];
    const before = [...rewards];

    const sorted = sortRewards(rewards);

    expect(rewards).toEqual(before);
    expect(sorted).not.toBe(rewards);
  });
});
