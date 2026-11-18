import type { Reward } from './types';

const collator = new Intl.Collator('it');

/** Active first, then inactive; each by points, then name (Italian collation). Returns a new array. */
export function sortRewards(rewards: readonly Reward[]): Reward[] {
  return rewards.toSorted(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.points - b.points ||
      collator.compare(a.name, b.name),
  );
}
