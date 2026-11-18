import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { CUSTOMER_ERROR_CODES } from './errorCodes';
import { supabaseCustomerService } from './supabaseCustomerService';
import { CustomerError } from './types';
import type { CustomerSummary } from './types';

type Answer = { data: unknown; error: unknown; status: number };

const db = vi.hoisted(() => ({
  schema: vi.fn<(name: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ schema: db.schema }),
}));

const ID = '6f1c2a5e-8b3d-4c7a-9e21-0d4b5f6a7c8e';
const OTHER_ID = '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b';
const OPERATION_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const row = {
  id: ID,
  name: 'Maria Rossi',
  phone: '+393330000001',
  notes: null,
  anonymized_at: null,
  balance: 0,
  last_served_at: null,
};
const customer: CustomerSummary = {
  id: ID,
  name: 'Maria Rossi',
  phone: '+393330000001',
  notes: null,
  anonymizedAt: null,
  balance: 0,
  lastServedAt: null,
};

/** An error raised by the app's functions, as PostgREST returns it. */
const raised = (message: string, details: string | null = null): Answer => ({
  data: null,
  error: { code: 'P0001', message, details, hint: null },
  status: 400,
});

const pgError = (code: string, status: number, message = 'error'): Answer => ({
  data: null,
  error: { code, message, details: null, hint: null },
  status,
});

/** What supabase-js returns when the request never got an answer (failed fetch). */
const noResponse: Answer = {
  data: null,
  error: { code: '', message: 'TypeError: Failed to fetch', details: '', hint: '' },
  status: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  db.schema.mockReturnValue({ rpc: db.rpc });
});

/** Every service call, with the RPC and arguments it must send and a well-formed answer. */
const calls = [
  {
    name: 'search',
    run: () => supabaseCustomerService.search('rossi'),
    rpc: ['search_customers', { p_query: 'rossi' }],
    data: [row],
    result: [customer],
  },
  {
    name: 'servedToday',
    run: () => supabaseCustomerService.servedToday(),
    rpc: ['customers_served_today'],
    data: [row],
    result: [customer],
  },
  {
    name: 'get',
    run: () => supabaseCustomerService.get(ID),
    rpc: ['get_customer', { p_customer_id: ID }],
    data: [row],
    result: customer,
  },
  {
    name: 'create',
    run: () =>
      supabaseCustomerService.create({
        operationId: OPERATION_ID,
        name: 'Maria Rossi',
        phone: '333 000 0001',
        privacyConsent: true,
        notes: '',
      }),
    rpc: [
      'create_customer',
      {
        p_operation_id: OPERATION_ID,
        p_name: 'Maria Rossi',
        p_phone: '333 000 0001',
        p_privacy_consent: true,
        p_notes: '',
      },
    ],
    data: row,
    result: customer,
  },
  {
    name: 'update',
    run: () =>
      supabaseCustomerService.update({ id: ID, name: 'Maria Rossi', phone: '', notes: 'Tavolo 4' }),
    rpc: [
      'update_customer',
      { p_customer_id: ID, p_name: 'Maria Rossi', p_phone: '', p_notes: 'Tavolo 4' },
    ],
    data: row,
    result: customer,
  },
  {
    name: 'anonymize',
    run: () => supabaseCustomerService.anonymize(ID),
    rpc: ['anonymize_customer', { p_customer_id: ID }],
    data: { ...row, name: 'Cliente cancellato 6f1c2a5e', phone: null },
    result: { ...customer, name: 'Cliente cancellato 6f1c2a5e', phone: null },
  },
] as const;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
}

async function customerError(promise: Promise<unknown>): Promise<CustomerError> {
  const error = await rejection(promise);
  if (!(error instanceof CustomerError))
    throw new Error('expected a CustomerError', { cause: error });
  return error;
}

describe.each(calls)('$name', ({ run, rpc, data, result }) => {
  it('calls its app RPC with snake_case arguments and maps the answer to camelCase', async () => {
    db.rpc.mockResolvedValue({ data, error: null, status: 200 });
    await expect(run()).resolves.toEqual(result);
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.rpc).toHaveBeenCalledWith(...rpc);
  });

  it.each(CUSTOMER_ERROR_CODES)('a raised %s is a CustomerError of that kind', async (code) => {
    db.rpc.mockResolvedValue(raised(code));
    expect((await customerError(run())).kind).toBe(code);
  });

  it('a failed fetch is network', async () => {
    db.rpc.mockResolvedValue(noResponse);
    expect((await customerError(run())).kind).toBe('network');
  });

  it('a throwing call is network', async () => {
    db.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await customerError(run())).kind).toBe('network');
  });

  it.each([
    ['PGRST202', 404, 'Could not find the function', 'misconfigured'],
    ['PGRST106', 406, 'Invalid schema: app', 'misconfigured'],
    ['42501', 401, 'permission denied for function search_customers', 'misconfigured'],
    ['PGRST002', 503, 'Could not query the database for the schema cache', 'unavailable'],
    ['', 503, 'Service Unavailable', 'unavailable'],
  ])('%s (HTTP %i) is a ServerFaultError', async (code, status, message, kind) => {
    db.rpc.mockResolvedValue(pgError(code, status, message));
    const error = await rejection(run());
    expect(error).toBeInstanceOf(ServerFaultError);
    expect(error).toMatchObject({ kind });
  });

  it.each([
    ['P0001', 400, 'some_future_code'],
    ['22023', 400, 'operation_id is required'],
    ['PGRST301', 401, 'JWT expired'],
    ['XX000', 500, 'internal error'],
  ])('any other error (%s, HTTP %i) is unknown', async (code, status, message) => {
    db.rpc.mockResolvedValue(pgError(code, status, message));
    expect((await customerError(run())).kind).toBe('unknown');
  });

  it('an answer of unexpected shape is unknown', async () => {
    const bad = { ...row, balance: '0' };
    db.rpc.mockResolvedValue({ data: Array.isArray(data) ? [bad] : bad, error: null, status: 200 });
    expect((await customerError(run())).kind).toBe('unknown');
  });

  it('keeps names and phones out of the error message', async () => {
    db.rpc.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'Maria Rossi +393330000001', details: null, hint: null },
      status: 500,
    });
    const error = await customerError(run());
    expect(error.message).not.toMatch(/Maria|3330000001/);
  });
});

describe('customer_name_taken', () => {
  it('carries the id of the existing customer from the detail', async () => {
    db.rpc.mockResolvedValue(raised('customer_name_taken', OTHER_ID));
    const error = await customerError(
      supabaseCustomerService.create({
        operationId: OPERATION_ID,
        name: 'maria rossi',
        phone: '',
        privacyConsent: true,
        notes: '',
      }),
    );
    expect(error.kind).toBe('customer_name_taken');
    expect(error.existingCustomerId).toBe(OTHER_ID);
  });

  it('a detail that is not a uuid gives no id', async () => {
    db.rpc.mockResolvedValue(raised('customer_name_taken', 'not-an-id'));
    const error = await customerError(
      supabaseCustomerService.update({ id: ID, name: 'Maria Rossi', phone: '', notes: '' }),
    );
    expect(error.kind).toBe('customer_name_taken');
    expect(error.existingCustomerId).toBeNull();
  });

  it('other codes carry no id', async () => {
    db.rpc.mockResolvedValue(raised('customer_not_found', OTHER_ID));
    expect((await customerError(supabaseCustomerService.anonymize(ID))).existingCustomerId).toBe(
      null,
    );
  });
});

describe('reads', () => {
  it('get answers null when no row comes back', async () => {
    db.rpc.mockResolvedValue({ data: [], error: null, status: 200 });
    await expect(supabaseCustomerService.get(ID)).resolves.toBeNull();
  });

  it('search keeps the 21st row, which tells the page there are more', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ ...row, id: `${index}` }));
    db.rpc.mockResolvedValue({ data: rows, error: null, status: 200 });
    await expect(supabaseCustomerService.search('rossi')).resolves.toHaveLength(21);
  });

  it('maps an anonymized customer with its date and a served time', async () => {
    db.rpc.mockResolvedValue({
      data: [
        {
          ...row,
          name: 'Cliente cancellato 6f1c2a5e',
          phone: null,
          notes: null,
          anonymized_at: '2026-11-17T10:00:00+00:00',
          balance: 12,
          last_served_at: '2026-11-18T09:58:00+00:00',
        },
      ],
      error: null,
      status: 200,
    });
    await expect(supabaseCustomerService.get(ID)).resolves.toEqual({
      ...customer,
      name: 'Cliente cancellato 6f1c2a5e',
      phone: null,
      anonymizedAt: '2026-11-17T10:00:00+00:00',
      balance: 12,
      lastServedAt: '2026-11-18T09:58:00+00:00',
    });
  });

  it('a list answer that is not an array is unknown', async () => {
    db.rpc.mockResolvedValue({ data: row, error: null, status: 200 });
    expect((await customerError(supabaseCustomerService.search('rossi'))).kind).toBe('unknown');
  });
});
