// Conversion between the text typed in a euro field and integer cents, at the UI
// edge only. The limits mirror the `check` constraints of `app.settings`.

export type EuroLimit = {
  /** Highest accepted value, in cents. */
  max: number;
  /** Italian message shown when the value is above `max`. */
  maxMessage: string;
};

export type ParseEuroResult = { ok: true; cents: number } | { ok: false; error: string };

/** `cents_per_point between 1 and 10000`. */
export const CENTS_PER_POINT_LIMIT: EuroLimit = {
  max: 10000,
  maxMessage: 'Al massimo 100,00 € per punto.',
};

/** `confirm_threshold_cents between 1 and 1000000`. */
export const CONFIRM_THRESHOLD_LIMIT: EuroLimit = {
  max: 1000000,
  maxMessage: 'Al massimo 10.000,00 €.',
};

const MESSAGES = {
  empty: 'Inserisci un importo, per esempio 1,00.',
  invalid: 'Scrivi solo cifre e la virgola, per esempio 1,50.',
  tooManyDecimals: 'Usa al massimo due decimali, per esempio 1,50.',
  zero: 'Deve essere maggiore di 0,00 €.',
} as const;

// Digits with at most one decimal separator (comma or dot) followed by at least one digit.
// No thousands separator: "1.250" has three decimals and is rejected rather than read as 1250.
const AMOUNT = /^(\d+)(?:[.,](\d+))?$/;

/** parseEuroInput("1,5", CENTS_PER_POINT_LIMIT) → { ok: true, cents: 150 }. */
export function parseEuroInput(text: string, limit: EuroLimit): ParseEuroResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: MESSAGES.empty };

  const match = AMOUNT.exec(trimmed);
  if (!match) return { ok: false, error: MESSAGES.invalid };

  const [, wholeDigits = '', decimals = ''] = match;
  if (decimals.length > 2) return { ok: false, error: MESSAGES.tooManyDecimals };

  // BigInt keeps very long inputs exact before comparing them with the limit.
  const cents = BigInt(wholeDigits) * 100n + BigInt(decimals.padEnd(2, '0'));
  if (cents === 0n) return { ok: false, error: MESSAGES.zero };
  if (cents > BigInt(limit.max)) return { ok: false, error: limit.maxMessage };

  return { ok: true, cents: Number(cents) };
}

/** centsToEuroInput(150) → "1,50": the initial text of a euro field, without grouping. */
export function centsToEuroInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`cents must be a non-negative safe integer, got ${cents}`);
  }
  const euros = Math.trunc(cents / 100);
  return `${euros},${String(cents % 100).padStart(2, '0')}`;
}
