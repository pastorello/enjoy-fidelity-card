import { ServerFaultError, serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import { fetchAllPages } from './fetchAllPages';
import { ExportError } from './types';
import type {
  CustomerExportRow,
  ExportErrorKind,
  ExportService,
  MovementExportKind,
  MovementExportRow,
} from './types';

// The only module that calls the export RPCs (app.export_customers, app.export_movements). It reads
// every page or rejects, and its errors are built from the server's code alone, never from its text:
// nothing a file contains can reach a message or a log.

/**
 * A page without an answer within 30 s counts as no connection, so the button never stays busy for
 * ever. Longer than the ledger's 8 s: a page carries up to 1000 rows over a phone connection.
 */
export const EXPORT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The SQLSTATEs the export RPCs raise (SPEC-export, "Modello dati e regole di accesso") and their
 * translation. 22023 (limit or cursor out of range) can only come from a bug in this client, so it is
 * unexpected. `scripts/exportBoundary.test.ts` checks the list against the migration.
 */
export const EXPORT_ERRCODES: Readonly<Record<string, ExportErrorKind>> = {
  '42501': 'forbidden',
  '22023': 'unknown',
};

/** The parts of a supabase-js answer this module looks at. */
type Answer = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  status?: number;
};

/** A supabase-js builder: awaitable and cancellable. */
type Request = PromiseLike<Answer> & { abortSignal(signal: AbortSignal): PromiseLike<Answer> };

function record(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  return { ...data };
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);
const isNullableInteger = (value: unknown): value is number | null =>
  value === null || isInteger(value);

function kindOf(value: unknown): MovementExportKind | null {
  return value === 'purchase' || value === 'redemption' || value === 'correction' ? value : null;
}

/** Maps a row of `app.export_customers` (snake_case), or null when its shape is unexpected. */
function toCustomer(data: unknown): CustomerExportRow | null {
  const row = record(data);
  if (!row) return null;
  const {
    id,
    name,
    phone,
    active_card_uid: activeCardUid,
    balance_points: balancePoints,
    privacy_consent_at: privacyConsentAt,
    notes,
    created_at: createdAt,
    created_by_name: createdByName,
    anonymized_at: anonymizedAt,
  } = row;
  if (
    !isString(id) ||
    !isNullableString(name) ||
    !isNullableString(phone) ||
    !isNullableString(activeCardUid) ||
    !isInteger(balancePoints) ||
    !isString(privacyConsentAt) ||
    !isNullableString(notes) ||
    !isString(createdAt) ||
    !isString(createdByName) ||
    !isNullableString(anonymizedAt)
  ) {
    return null;
  }
  return {
    id,
    name,
    phone,
    activeCardUid,
    balancePoints,
    privacyConsentAt,
    notes,
    createdAt,
    createdByName,
    anonymizedAt,
  };
}

/** Maps a row of `app.export_movements` (snake_case), or null when its shape is unexpected. */
function toMovement(data: unknown): MovementExportRow | null {
  const row = record(data);
  if (!row) return null;
  const kind = kindOf(row.kind);
  const {
    id,
    created_at: createdAt,
    customer_id: customerId,
    customer_name: customerName,
    amount_cents: amountCents,
    points,
    cents_per_point: centsPerPoint,
    description,
    operator_name: operatorName,
    corrects_movement_id: correctsMovementId,
    corrected_by_movement_id: correctedByMovementId,
  } = row;
  if (
    !kind ||
    !isString(id) ||
    !isString(createdAt) ||
    !isString(customerId) ||
    !isNullableString(customerName) ||
    !isNullableInteger(amountCents) ||
    !isInteger(points) ||
    !isNullableInteger(centsPerPoint) ||
    !isNullableString(description) ||
    !isString(operatorName) ||
    !isNullableString(correctsMovementId) ||
    !isNullableString(correctedByMovementId)
  ) {
    return null;
  }
  return {
    id,
    createdAt,
    customerId,
    customerName,
    kind,
    amountCents,
    points,
    centsPerPoint,
    description,
    operatorName,
    correctsMovementId,
    correctedByMovementId,
  };
}

/** The error to reject with, or null when the answer carries data. */
function failureOf(answer: Answer): Error | null {
  const { error } = answer;
  const status = answer.status ?? 0;
  if (!error) return null;
  // supabase-js answers a failed fetch with status 0 instead of throwing.
  if (status === 0) return new ExportError('network');
  // A missing grant (42501 "permission denied for function") is the server's fault, not a refusal.
  const fault = serverFaultFor(error, status);
  if (fault) return new ServerFaultError(fault);
  const code = error.code ?? '';
  return new ExportError(
    Object.hasOwn(EXPORT_ERRCODES, code) ? (EXPORT_ERRCODES[code] ?? 'unknown') : 'unknown',
  );
}

/**
 * Calls one export RPC and returns its rows. A thrown fetch (`TypeError`) or no answer within the
 * timeout rejects with `network` and aborts the request; a malformed row rejects with `unknown`.
 */
async function readPage<Row>(
  fn: 'export_customers' | 'export_movements',
  args: Record<string, unknown>,
  toRow: (data: unknown) => Row | null,
): Promise<Row[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ExportError('network'));
    }, EXPORT_REQUEST_TIMEOUT_MS);
  });
  let answer: Answer;
  try {
    const request: Request = getSupabase().schema('app').rpc(fn, args);
    answer = await Promise.race([request.abortSignal(controller.signal), timeout]);
  } catch {
    throw new ExportError('network');
  } finally {
    clearTimeout(timer);
  }
  const failure = failureOf(answer);
  if (failure) throw failure;
  if (!Array.isArray(answer.data)) throw new ExportError('unknown');
  const data: unknown[] = answer.data;
  const rows = data.map(toRow);
  if (rows.some((row) => row === null)) throw new ExportError('unknown');
  return rows.filter((row) => row !== null);
}

type MovementCursor = { createdAt: string; id: string };

export const supabaseExportService: ExportService = {
  fetchCustomers() {
    return fetchAllPages<CustomerExportRow, string>(
      (afterId, limit) =>
        readPage('export_customers', { p_after_id: afterId, p_limit: limit }, toCustomer),
      (row) => row.id,
    );
  },

  fetchMovements() {
    return fetchAllPages<MovementExportRow, MovementCursor>(
      (after, limit) =>
        readPage(
          'export_movements',
          {
            // The cursor's created_at goes back exactly as the server sent it (microseconds kept).
            p_after_created_at: after?.createdAt ?? null,
            p_after_id: after?.id ?? null,
            p_limit: limit,
          },
          toMovement,
        ),
      (row) => ({ createdAt: row.createdAt, id: row.id }),
    );
  },
};
