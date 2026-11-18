// Validation of the reward form, at the UI edge. The limits mirror the `check` constraints of
// `app.rewards`; the server repeats every check.

/** `length(name) between 1 and 60`. */
export const REWARD_NAME_MAX = 60;
/** `points between 1 and 99999`. */
export const REWARD_POINTS_MAX = 99999;

const MESSAGES = {
  nameRequired: 'Scrivi il nome del premio',
  nameTooLong: 'Il nome è troppo lungo (massimo 60 caratteri)',
  pointsInvalid: 'Scrivi i punti: un numero intero maggiore di zero',
  pointsTooHigh: 'Al massimo 99.999 punti',
} as const;

export type RewardFormValues = { name: string; points: string };
export type RewardFormErrors = { name?: string; points?: string };
export type ValidateRewardResult =
  { ok: true; reward: { name: string; points: number } } | { ok: false; errors: RewardFormErrors };

// Digits only: no decimals, signs, exponents or inner spaces.
const DIGITS = /^\d+$/;

/** validateReward({ name: ' Spremuta ', points: '80' }) → { ok: true, reward: { name: 'Spremuta', points: 80 } }. */
export function validateReward(values: RewardFormValues): ValidateRewardResult {
  const errors: RewardFormErrors = {};

  const name = values.name.trim();
  // Characters as Postgres `length` counts them, not UTF-16 units.
  const nameLength = Array.from(name).length;
  if (nameLength === 0) errors.name = MESSAGES.nameRequired;
  else if (nameLength > REWARD_NAME_MAX) errors.name = MESSAGES.nameTooLong;

  const pointsText = values.points.trim();
  let points = 0;
  if (!DIGITS.test(pointsText)) errors.points = MESSAGES.pointsInvalid;
  else {
    // BigInt keeps very long inputs exact before comparing them with the limit.
    const value = BigInt(pointsText);
    if (value === 0n) errors.points = MESSAGES.pointsInvalid;
    else if (value > BigInt(REWARD_POINTS_MAX)) errors.points = MESSAGES.pointsTooHigh;
    else points = Number(value);
  }

  if (errors.name !== undefined || errors.points !== undefined) return { ok: false, errors };
  return { ok: true, reward: { name, points } };
}
