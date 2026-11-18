import { ServerFaultError, serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import { isCustomerErrorCode } from './errorCodes';
import { CustomerError } from './types';
import type { CustomerService, CustomerSummary } from './types';

// The only module that calls the customers RPCs (scripts/customersBoundary.test.ts).

/** The parts of a supabase-js answer this module looks at. */
type Answer = {
  data: unknown;
  error: { code?: string; message?: string; details?: string | null } | null;
  status: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Maps an `app.customer_summary` row (snake_case), or null when its shape is unexpected. */
function toCustomer(data: unknown): CustomerSummary | null {
  if (typeof data !== 'object' || data === null) return null;
  const row: Record<string, unknown> = { ...data };
  const { id, name, phone, notes, balance } = row;
  const { anonymized_at: anonymizedAt, last_served_at: lastServedAt } = row;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    !isNullableString(phone) ||
    !isNullableString(notes) ||
    !isNullableString(anonymizedAt) ||
    typeof balance !== 'number' ||
    !Number.isInteger(balance) ||
    !isNullableString(lastServedAt)
  ) {
    return null;
  }
  return { id, name, phone, notes, anonymizedAt, balance, lastServedAt };
}

/** The error to reject with, or null when the answer carries data. */
function failureOf(answer: Answer): Error | null {
  const { error, status } = answer;
  if (!error) return null;
  // supabase-js answers a failed fetch with status 0 instead of throwing.
  if (status === 0) return new CustomerError('network');
  const fault = serverFaultFor(error, status);
  if (fault) return new ServerFaultError(fault);
  const code = error.message ?? '';
  if (error.code !== 'P0001' || !isCustomerErrorCode(code)) return new CustomerError('unknown');
  if (code !== 'customer_name_taken') return new CustomerError(code);
  const existing = error.details ?? '';
  return new CustomerError(code, UUID.test(existing) ? existing : null);
}

/** Calls an `app` RPC; never lets a thrown fetch error out as anything but `network`. */
async function call(fn: string, args?: Record<string, unknown>): Promise<unknown> {
  let answer: Answer;
  try {
    const rpc = getSupabase().schema('app');
    answer = await (args === undefined ? rpc.rpc(fn) : rpc.rpc(fn, args));
  } catch {
    throw new CustomerError('network');
  }
  const failure = failureOf(answer);
  if (failure) throw failure;
  return answer.data;
}

async function one(fn: string, args: Record<string, unknown>): Promise<CustomerSummary> {
  const customer = toCustomer(await call(fn, args));
  if (!customer) throw new CustomerError('unknown');
  return customer;
}

async function many(fn: string, args?: Record<string, unknown>): Promise<CustomerSummary[]> {
  const data = await call(fn, args);
  if (!Array.isArray(data)) throw new CustomerError('unknown');
  const customers: unknown[] = data;
  return customers.map((item) => {
    const customer = toCustomer(item);
    if (!customer) throw new CustomerError('unknown');
    return customer;
  });
}

export const supabaseCustomerService: CustomerService = {
  search(query) {
    return many('search_customers', { p_query: query });
  },

  servedToday() {
    return many('customers_served_today');
  },

  async get(id) {
    const [customer = null] = await many('get_customer', { p_customer_id: id });
    return customer;
  },

  create({ operationId, name, phone, privacyConsent, notes }) {
    return one('create_customer', {
      p_operation_id: operationId,
      p_name: name,
      p_phone: phone,
      p_privacy_consent: privacyConsent,
      p_notes: notes,
    });
  },

  update({ id, name, phone, notes }) {
    return one('update_customer', {
      p_customer_id: id,
      p_name: name,
      p_phone: phone,
      p_notes: notes,
    });
  },

  anonymize(id) {
    return one('anonymize_customer', { p_customer_id: id });
  },
};
