import { CustomerError } from './types';
import type { CustomerListRow } from './types';

/**
 * Maps a row of `app.list_customers` (snake_case), or null when its shape is unexpected. Its own
 * parser, not `customerRow.ts`: the list has no notes nor anonymized date. Timestamps stay the
 * strings PostgREST sent (microseconds included), because the next page's cursor sends them back
 * unchanged; anything else in the row (an email, say) is dropped.
 */
export function toCustomerListRow(data: unknown): CustomerListRow | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const row: Record<string, unknown> = { ...data };
  const { id, name, balance } = row;
  const { last_activity_at: lastActivityAt, created_at: createdAt } = row;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof balance !== 'number' ||
    !Number.isInteger(balance) ||
    (lastActivityAt !== null && typeof lastActivityAt !== 'string') ||
    typeof createdAt !== 'string'
  ) {
    return null;
  }
  return { id, name, balance, lastActivityAt, createdAt };
}

/** Every row of a `app.list_customers` answer; `unknown` when the answer or a row is malformed. */
export function parseCustomerList(data: unknown): CustomerListRow[] {
  if (!Array.isArray(data)) throw new CustomerError('unknown');
  const rows: unknown[] = data;
  return rows.map((item) => toCustomerListRow(item) ?? fail());
}

function fail(): never {
  throw new CustomerError('unknown');
}
