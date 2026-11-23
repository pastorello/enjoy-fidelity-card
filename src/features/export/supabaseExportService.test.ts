import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { EXPORT_PAGE_LIMIT } from './fetchAllPages';
import {
  EXPORT_ERRCODES,
  EXPORT_REQUEST_TIMEOUT_MS,
  supabaseExportService as service,
} from './supabaseExportService';
import { ExportError } from './types';
import type { CustomerExportRow, ExportErrorKind, MovementExportRow } from './types';

type Answer = { data: unknown; error: unknown; status: number };

const db = vi.hoisted(() => ({
  schema: vi.fn<(name: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: unknown) => unknown>(),
  signals: [] as AbortSignal[],
  /** The answers of the next RPC calls, in order; the last one repeats. */
  answers: [] as (() => Promise<unknown>)[],
}));
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ schema: db.schema }),
}));

/** A supabase-js RPC builder: cancellable with `abortSignal()` and awaitable. */
function builder(): Promise<unknown> {
  const next = db.answers.length > 1 ? db.answers.shift() : db.answers[0];
  const pending = next ? next() : Promise.resolve(null);
  // A test that never awaits the request must not leave its rejection unhandled.
  pending.catch(() => undefined);
  const query = Object.assign(pending, {
    abortSignal: (signal: AbortSignal) => {
      db.signals.push(signal);
      return query;
    },
  });
  return query;
}

function answers(...values: (Answer | Error | 'never')[]) {
  db.answers = values.map((value) => () => {
    if (value === 'never') return new Promise<never>(() => undefined);
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

const CUSTOMER = '3a9f1c2e-5b7d-4e8a-9c0b-1d2e3f4a5b6c';
const MOVEMENT = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const CORRECTION = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

/** A row of `app.export_customers` as PostgREST returns it. */
const customerRow = (overrides: Record<string, unknown> = {}) => ({
  id: CUSTOMER,
  name: 'Cliente di prova',
  email: 'cliente.prova@example.com',
  active_card_uid: '04A1B2C3D4E5F6',
  balance_points: 112,
  privacy_consent_at: '2026-11-01T09:00:00+00:00',
  notes: 'Preferisce il tavolo fuori',
  created_at: '2026-11-01T09:00:00.123456+00:00',
  created_by_name: 'Operatore di prova',
  anonymized_at: null,
  ...overrides,
});

const customer: CustomerExportRow = {
  id: CUSTOMER,
  name: 'Cliente di prova',
  email: 'cliente.prova@example.com',
  activeCardUid: '04A1B2C3D4E5F6',
  balancePoints: 112,
  privacyConsentAt: '2026-11-01T09:00:00+00:00',
  notes: 'Preferisce il tavolo fuori',
  createdAt: '2026-11-01T09:00:00.123456+00:00',
  createdByName: 'Operatore di prova',
  anonymizedAt: null,
};

/** A row of `app.export_movements` as PostgREST returns it. */
const movementRow = (overrides: Record<string, unknown> = {}) => ({
  id: MOVEMENT,
  created_at: '2026-11-18T09:00:00.123456+00:00',
  customer_id: CUSTOMER,
  customer_name: 'Cliente di prova',
  kind: 'purchase',
  amount_cents: 1250,
  points: 12,
  cents_per_point: 100,
  description: null,
  operator_name: 'Operatore di prova',
  corrects_movement_id: null,
  corrected_by_movement_id: CORRECTION,
  ...overrides,
});

const movement: MovementExportRow = {
  id: MOVEMENT,
  createdAt: '2026-11-18T09:00:00.123456+00:00',
  customerId: CUSTOMER,
  customerName: 'Cliente di prova',
  kind: 'purchase',
  amountCents: 1250,
  points: 12,
  centsPerPoint: 100,
  description: null,
  operatorName: 'Operatore di prova',
  correctsMovementId: null,
  correctedByMovementId: CORRECTION,
};

const ok = (data: unknown): Answer => ({ data, error: null, status: 200 });

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

/** `count` distinct rows whose id ends with their index, so pages can be told apart. */
function page<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => make(index));
}
const uuidAt = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

beforeEach(() => {
  vi.resetAllMocks();
  db.signals = [];
  db.answers = [];
  db.schema.mockReturnValue({ rpc: db.rpc });
  db.rpc.mockImplementation(() => builder());
});

afterEach(() => {
  vi.useRealTimers();
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
}

async function exportErrorOf(promise: Promise<unknown>): Promise<ExportErrorKind> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(ExportError);
  return error instanceof ExportError ? error.kind : 'unknown';
}

const reads = [
  ['fetchCustomers', () => service.fetchCustomers()],
  ['fetchMovements', () => service.fetchMovements()],
] as const;

describe('fetchCustomers', () => {
  it('calls app.export_customers from the start with the page limit and maps the columns', async () => {
    answers(ok([customerRow()]));
    await expect(service.fetchCustomers()).resolves.toEqual([customer]);
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('export_customers', {
      p_after_id: null,
      p_limit: EXPORT_PAGE_LIMIT,
    });
  });

  it('keeps the personal fields null for an anonymized customer, with the balance', async () => {
    const anonymized = customerRow({
      name: null,
      email: null,
      notes: null,
      active_card_uid: null,
      balance_points: 0,
      anonymized_at: '2026-11-10T10:00:00+00:00',
    });
    answers(ok([anonymized]));
    await expect(service.fetchCustomers()).resolves.toEqual([
      {
        ...customer,
        name: null,
        email: null,
        notes: null,
        activeCardUid: null,
        balancePoints: 0,
        anonymizedAt: '2026-11-10T10:00:00+00:00',
      },
    ]);
  });

  it('asks for the next page after the id of the last row of a full page', async () => {
    const full = page(EXPORT_PAGE_LIMIT, (index) => customerRow({ id: uuidAt(index) }));
    answers(ok(full), ok([customerRow({ id: uuidAt(EXPORT_PAGE_LIMIT) })]));
    const rows = await service.fetchCustomers();
    expect(rows).toHaveLength(EXPORT_PAGE_LIMIT + 1);
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenLastCalledWith('export_customers', {
      p_after_id: uuidAt(EXPORT_PAGE_LIMIT - 1),
      p_limit: EXPORT_PAGE_LIMIT,
    });
  });

  it('rejects with unknown when a row has an unexpected shape', async () => {
    answers(ok([customerRow({ balance_points: '112' })]));
    expect(await exportErrorOf(service.fetchCustomers())).toBe('unknown');
    answers(ok([customerRow({ created_by_name: null })]));
    expect(await exportErrorOf(service.fetchCustomers())).toBe('unknown');
    answers(ok({ id: CUSTOMER }));
    expect(await exportErrorOf(service.fetchCustomers())).toBe('unknown');
    answers(ok([customerRow({ email: 42 })]));
    expect(await exportErrorOf(service.fetchCustomers())).toBe('unknown');
    const { email: _missing, ...withoutEmail } = customerRow();
    answers(ok([withoutEmail]));
    expect(await exportErrorOf(service.fetchCustomers())).toBe('unknown');
  });
});

describe('fetchMovements', () => {
  it('calls app.export_movements from the start with both cursor fields null', async () => {
    answers(ok([movementRow()]));
    await expect(service.fetchMovements()).resolves.toEqual([movement]);
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('export_movements', {
      p_after_created_at: null,
      p_after_id: null,
      p_limit: EXPORT_PAGE_LIMIT,
    });
  });

  it('maps a redemption and a correction', async () => {
    answers(
      ok([
        movementRow({
          kind: 'redemption',
          amount_cents: null,
          points: -50,
          cents_per_point: null,
          description: 'Caffè offerto',
          corrected_by_movement_id: null,
        }),
        movementRow({
          id: CORRECTION,
          kind: 'correction',
          amount_cents: null,
          points: -12,
          cents_per_point: null,
          corrects_movement_id: MOVEMENT,
          corrected_by_movement_id: null,
          customer_name: null,
        }),
      ]),
    );
    const [redemption, correction] = await service.fetchMovements();
    expect(redemption).toMatchObject({
      kind: 'redemption',
      amountCents: null,
      points: -50,
      description: 'Caffè offerto',
    });
    expect(correction).toMatchObject({
      id: CORRECTION,
      kind: 'correction',
      correctsMovementId: MOVEMENT,
      customerName: null,
    });
  });

  it('passes the created_at of the last row exactly as received, microseconds included', async () => {
    const createdAt = '2026-11-18T09:00:00.123456+00:00';
    const full = page(EXPORT_PAGE_LIMIT, (index) =>
      movementRow({ id: uuidAt(index), created_at: createdAt }),
    );
    answers(ok(full), ok([]));
    const rows = await service.fetchMovements();
    expect(rows).toHaveLength(EXPORT_PAGE_LIMIT);
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenLastCalledWith('export_movements', {
      p_after_created_at: createdAt,
      p_after_id: uuidAt(EXPORT_PAGE_LIMIT - 1),
      p_limit: EXPORT_PAGE_LIMIT,
    });
  });

  it('rejects with unknown when a row has an unexpected shape', async () => {
    answers(ok([movementRow({ kind: 'gift' })]));
    expect(await exportErrorOf(service.fetchMovements())).toBe('unknown');
    answers(ok([movementRow({ amount_cents: 12.5 })]));
    expect(await exportErrorOf(service.fetchMovements())).toBe('unknown');
  });
});

describe('errors', () => {
  it.each(reads)('%s: the app 42501 (not an admin) is forbidden', async (_name, read) => {
    answers(pgError('42501', 403, 'forbidden'));
    expect(await exportErrorOf(read())).toBe('forbidden');
  });

  it.each(reads)(
    '%s: a 42501 "permission denied for function" is a server fault, not a refusal',
    async (_name, read) => {
      answers(pgError('42501', 403, 'permission denied for function export_customers'));
      const error = await rejection(read());
      expect(error).toBeInstanceOf(ServerFaultError);
      expect(error).toMatchObject({ kind: 'misconfigured' });
    },
  );

  it.each(reads)(
    '%s: a function missing from the schema cache is a server fault',
    async (_n, read) => {
      answers(pgError('PGRST202', 404));
      await expect(read()).rejects.toMatchObject({
        name: 'ServerFaultError',
        kind: 'misconfigured',
      });
    },
  );

  it.each(reads)('%s: a reloading API is a server fault', async (_name, read) => {
    answers(pgError('PGRST002', 503));
    await expect(read()).rejects.toMatchObject({ name: 'ServerFaultError', kind: 'unavailable' });
  });

  it.each(reads)('%s: a failed fetch (status 0) is network', async (_name, read) => {
    answers(noResponse);
    expect(await exportErrorOf(read())).toBe('network');
  });

  it.each(reads)('%s: a thrown TypeError of fetch is network', async (_name, read) => {
    answers(new TypeError('Failed to fetch'));
    expect(await exportErrorOf(read())).toBe('network');
  });

  it.each(reads)('%s: any other code is unknown (22023 included)', async (_name, read) => {
    answers(pgError('22023', 400, 'invalid_limit'));
    expect(await exportErrorOf(read())).toBe('unknown');
    answers(pgError('XX000', 500));
    expect(await exportErrorOf(read())).toBe('unknown');
  });

  it('a network failure on the second page rejects with no rows', async () => {
    const full = page(EXPORT_PAGE_LIMIT, (index) => customerRow({ id: uuidAt(index) }));
    answers(ok(full), noResponse);
    expect(await exportErrorOf(service.fetchCustomers())).toBe('network');
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it('an error message never carries row content', async () => {
    answers(pgError('XX000', 500, 'Cliente di prova'));
    const error = await rejection(service.fetchCustomers());
    expect(String(error)).not.toContain('Cliente di prova');
  });

  it('translates each errcode the export migration raises', () => {
    expect(EXPORT_ERRCODES).toEqual({ '42501': 'forbidden', '22023': 'unknown' });
  });
});

describe('timeout', () => {
  it.each(reads)(
    '%s: a page without an answer is aborted and rejects with network',
    async (_n, read) => {
      vi.useFakeTimers();
      answers('never');
      const pending = exportErrorOf(read());
      await vi.advanceTimersByTimeAsync(EXPORT_REQUEST_TIMEOUT_MS);
      expect(await pending).toBe('network');
      expect(db.signals[0]?.aborted).toBe(true);
    },
  );

  it('the timer does not fire on a page that answered in time', async () => {
    vi.useFakeTimers();
    answers(ok([]));
    await expect(service.fetchMovements()).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(db.signals[0]?.aborted).toBe(false);
  });
});
