import { ServerFaultError, serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import { parseCustomerList } from './customerListRow';
import { toCustomerSummary } from './customerRow';
import { isCustomerErrorCode, pointsAtExistingCustomer } from './errorCodes';
import { CUSTOMER_LIST_PAGE_SIZE, CustomerError } from './types';
import type { CustomerService, CustomerSummary } from './types';

// The only module that calls the customers RPCs (scripts/customersBoundary.test.ts).

/** The parts of a supabase-js answer this module looks at. */
type Answer = {
  data: unknown;
  error: { code?: string; message?: string; details?: string | null } | null;
  status: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!pointsAtExistingCustomer(code)) return new CustomerError(code);
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
  const customer = toCustomerSummary(await call(fn, args));
  if (!customer) throw new CustomerError('unknown');
  return customer;
}

async function many(fn: string, args?: Record<string, unknown>): Promise<CustomerSummary[]> {
  const data = await call(fn, args);
  if (!Array.isArray(data)) throw new CustomerError('unknown');
  const customers: unknown[] = data;
  return customers.map((item) => {
    const customer = toCustomerSummary(item);
    if (!customer) throw new CustomerError('unknown');
    return customer;
  });
}

export const supabaseCustomerService: CustomerService = {
  // The cursor goes back exactly as received. invalid_cursor and invalid_limit (22023) can only
  // come from a bug in this client: like any unexpected answer, they are `unknown`.
  async list({ query, after }) {
    const customers = parseCustomerList(
      await call('list_customers', {
        p_query: query,
        p_after_activity_at: after?.activityAt ?? null,
        p_after_created_at: after?.createdAt ?? null,
        p_after_id: after?.id ?? null,
        p_limit: CUSTOMER_LIST_PAGE_SIZE,
      }),
    );
    return { customers, hasMore: customers.length === CUSTOMER_LIST_PAGE_SIZE };
  },

  async get(id) {
    const [customer = null] = await many('get_customer', { p_customer_id: id });
    return customer;
  },

  create({ operationId, name, phone, email, privacyConsent, notes }) {
    return one('create_customer', {
      p_operation_id: operationId,
      p_name: name,
      p_phone: phone,
      p_email: email,
      p_privacy_consent: privacyConsent,
      p_notes: notes,
    });
  },

  update({ id, name, phone, email, notes }) {
    return one('update_customer', {
      p_customer_id: id,
      p_name: name,
      p_phone: phone,
      p_email: email,
      p_notes: notes,
    });
  },

  anonymize(id) {
    return one('anonymize_customer', { p_customer_id: id });
  },
};
