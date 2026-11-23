import type { CustomerSummary } from './types';

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * Maps an `app.customer_summary` row (snake_case), or null when its shape is unexpected. Shared by
 * the services whose RPCs return that type (customers, and cards' `create_customer_with_card`).
 * Attributes it does not know are dropped (no phone: SPEC-customers-v2, point 1).
 */
export function toCustomerSummary(data: unknown): CustomerSummary | null {
  if (typeof data !== 'object' || data === null) return null;
  const row: Record<string, unknown> = { ...data };
  const { id, name, email, notes, balance } = row;
  const { anonymized_at: anonymizedAt, last_served_at: lastServedAt } = row;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    !isNullableString(email) ||
    !isNullableString(notes) ||
    !isNullableString(anonymizedAt) ||
    typeof balance !== 'number' ||
    !Number.isInteger(balance) ||
    !isNullableString(lastServedAt)
  ) {
    return null;
  }
  return { id, name, email, notes, anonymizedAt, balance, lastServedAt };
}
