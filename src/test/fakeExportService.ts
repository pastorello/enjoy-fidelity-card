import { vi } from 'vitest';
import type { DownloadFile } from '../features/export/downloadFile';
import { EXPORT_PAGE_LIMIT, fetchAllPages } from '../features/export/fetchAllPages';
import { ExportError } from '../features/export/types';
import type {
  CustomerExportRow,
  ExportErrorKind,
  ExportService,
  MovementExportRow,
} from '../features/export/types';

type Method = keyof ExportService;

/** What a programmed page does instead of answering: reject with that kind or with that error. */
export type FakeExportFailure = ExportErrorKind | Error;

/** One logged call of the service. */
export type FakeExportCall = { method: Method };

type MovementCursor = { createdAt: string; id: string };

/** One page request, as the Supabase service would send it to the RPC. */
export type FakeExportPage = {
  method: Method;
  /** 1 for the first page of the call. */
  page: number;
  cursor: string | MovementCursor | null;
  limit: number;
};

/** The caller's role on the server; null: no operator profile (or an unlinked operator). */
type Role = 'admin' | 'operator' | null;

type FakeOptions = {
  /** The rows of `app.export_customers`; two fake customers (one anonymized) when missing. */
  customers?: CustomerExportRow[];
  /** The rows of `app.export_movements`; a purchase, a redemption and its correction when missing. */
  movements?: MovementExportRow[];
  role?: Role;
  /** Rows per page; smaller than 1000 to test the paging with few rows. */
  pageLimit?: number;
};

let nextFixture = 0;

function fixtureCounter(): string {
  nextFixture += 1;
  return String(nextFixture).padStart(12, '0');
}

/** A customer as `export_customers` returns it, with fake data and a fresh UUID-shaped id. */
export function fakeCustomerExportRow(
  overrides: Partial<CustomerExportRow> = {},
): CustomerExportRow {
  const counter = fixtureCounter();
  return {
    id: `00000000-0000-4000-8000-${counter}`,
    name: `Cliente Prova ${counter.slice(-4)}`,
    phone: '+393330000000',
    activeCardUid: null,
    balancePoints: 0,
    privacyConsentAt: '2026-11-17T09:00:00.000000+00:00',
    notes: null,
    createdAt: '2026-11-17T09:00:00.000000+00:00',
    createdByName: 'Giulia Prova',
    anonymizedAt: null,
    ...overrides,
  };
}

/** A purchase of 12,50 € as `export_movements` returns it, with a fresh UUID-shaped id. */
export function fakeMovementExportRow(
  overrides: Partial<MovementExportRow> = {},
): MovementExportRow {
  const counter = fixtureCounter();
  return {
    id: `00000000-0000-4000-d000-${counter}`,
    createdAt: '2026-11-17T18:10:00.000000+00:00',
    customerId: '00000000-0000-4000-8000-000000000001',
    customerName: 'Maria Prova',
    kind: 'purchase',
    amountCents: 1250,
    points: 12,
    centsPerPoint: 100,
    description: null,
    operatorName: 'Giulia Prova',
    correctsMovementId: null,
    correctedByMovementId: null,
    ...overrides,
  };
}

function defaultRows(): { customers: CustomerExportRow[]; movements: MovementExportRow[] } {
  const maria = fakeCustomerExportRow({
    name: 'Maria Prova',
    phone: '+393331234567',
    activeCardUid: '04A1B2C3D4E5F6',
    balancePoints: 12,
  });
  const gone = fakeCustomerExportRow({
    name: null,
    phone: null,
    balancePoints: 0,
    anonymizedAt: '2026-11-17T12:00:00.000000+00:00',
  });
  const purchase = fakeMovementExportRow({
    customerId: maria.id,
    createdAt: '2026-11-17T18:10:00.000000+00:00',
  });
  const redemption = fakeMovementExportRow({
    customerId: maria.id,
    customerName: maria.name,
    createdAt: '2026-11-17T18:20:00.000000+00:00',
    kind: 'redemption',
    amountCents: null,
    points: -5,
    centsPerPoint: null,
    description: 'Caffè',
  });
  const correction = fakeMovementExportRow({
    customerId: maria.id,
    customerName: maria.name,
    createdAt: '2026-11-17T18:20:05.000000+00:00',
    kind: 'correction',
    amountCents: null,
    points: 5,
    centsPerPoint: null,
    correctsMovementId: redemption.id,
  });
  redemption.correctedByMovementId = correction.id;
  return { customers: [maria, gone], movements: [purchase, redemption, correction] };
}

/** The server's order: `id` for customers. Plain string order, as Postgres compares uuids. */
function byId(a: { id: string }, b: { id: string }): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** The server's order for movements: `(created_at, id)`. */
function byCreatedAtThenId(a: MovementExportRow, b: MovementExportRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return byId(a, b);
}

function perMethod<T>(make: () => T): Record<Method, T> {
  return { fetchCustomers: make(), fetchMovements: make() };
}

/**
 * In-memory ExportService for component tests, following the export RPCs: every page checks the role
 * first (an operator or a user without a profile gets `forbidden`), rows come in server order, in pages
 * of `pageLimit` read with `fetchAllPages` like the Supabase service, so a failure on any page rejects
 * with no rows. Every method is a `vi.fn`; every call is logged in `calls` and every page in `pages`.
 * `failPage` programs a failure on the n-th page of the next call, `holdNext` delays a call until
 * released, `setNetworkDown` makes every page fail with `network`, `setRole` changes the role on the
 * server. `download` is a spy for `ExportServiceProvider` that keeps the files in `downloads`.
 */
export function createFakeExportService({
  customers: initialCustomers,
  movements: initialMovements,
  role: initialRole = 'admin',
  pageLimit = EXPORT_PAGE_LIMIT,
}: FakeOptions = {}) {
  const defaults = initialCustomers && initialMovements ? null : defaultRows();
  const customers = (initialCustomers ?? defaults?.customers ?? []).toSorted(byId);
  const movements = (initialMovements ?? defaults?.movements ?? []).toSorted(byCreatedAtThenId);
  let role: Role = initialRole;
  let networkDown = false;
  const failures = perMethod<Map<number, FakeExportFailure>[]>(() => []);
  const holds = perMethod<Promise<void>[]>(() => []);
  const calls: FakeExportCall[] = [];
  const pages: FakeExportPage[] = [];
  const downloads: { fileName: string; content: string }[] = [];

  /** Answers one page as the RPC would: role first, then the rows after the cursor. */
  function readPage<Row>(
    method: Method,
    programmed: Map<number, FakeExportFailure> | undefined,
    page: number,
    cursor: FakeExportPage['cursor'],
    limit: number,
    rows: () => Row[],
  ): Promise<Row[]> {
    pages.push({ method, page, cursor, limit });
    const failure = programmed?.get(page);
    if (networkDown) return Promise.reject(new ExportError('network'));
    if (failure instanceof Error) return Promise.reject(failure);
    if (failure !== undefined) return Promise.reject(new ExportError(failure));
    if (role !== 'admin') return Promise.reject(new ExportError('forbidden'));
    return Promise.resolve(structuredClone(rows().slice(0, limit)));
  }

  /** Logs the call, waits for its hold if any, then reads every page. */
  async function run<Row, Cursor extends FakeExportPage['cursor']>(
    method: Method,
    after: (cursor: Cursor | null) => Row[],
    cursorOf: (row: Row) => Cursor,
  ): Promise<Row[]> {
    calls.push({ method });
    const programmed = failures[method].shift();
    const hold = holds[method].shift();
    if (hold) await hold;
    let page = 0;
    return fetchAllPages<Row, Cursor>(
      (cursor, limit) => {
        page += 1;
        return readPage(method, programmed, page, cursor, limit, () => after(cursor));
      },
      cursorOf,
      pageLimit,
    );
  }

  const service = {
    fetchCustomers: vi.fn<ExportService['fetchCustomers']>(() =>
      run<CustomerExportRow, string>(
        'fetchCustomers',
        (afterId) => customers.filter((row) => afterId === null || row.id > afterId),
        (row) => row.id,
      ),
    ),
    fetchMovements: vi.fn<ExportService['fetchMovements']>(() =>
      run<MovementExportRow, MovementCursor>(
        'fetchMovements',
        (after) =>
          movements.filter(
            (row) =>
              after === null ||
              row.createdAt > after.createdAt ||
              (row.createdAt === after.createdAt && row.id > after.id),
          ),
        (row) => ({ createdAt: row.createdAt, id: row.id }),
      ),
    ),
  } satisfies ExportService;

  const download = vi.fn<DownloadFile>((fileName, content) => {
    downloads.push({ fileName, content });
  });

  return {
    service,
    /** Every call of the service, in order. */
    calls,
    /** Every page request, in order, with its cursor and limit. */
    pages,
    /** The download spy to give to `ExportServiceProvider`. */
    download,
    /** The files the spy received, in order. */
    downloads,
    /** The customer rows, in server order. */
    customers: () => structuredClone(customers),
    /** The movement rows, in server order. */
    movements: () => structuredClone(movements),
    /** Programs a failure on page `page` (1 = first) of the next call of `method`. */
    failPage(method: Method, page: number, failure: FakeExportFailure) {
      failures[method].push(new Map([[page, failure]]));
    },
    /** Delays the next call of `method` until `release()`. */
    holdNext(method: Method) {
      let release!: () => void;
      holds[method].push(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return { release };
    },
    /** While down, every page rejects with `network`. */
    setNetworkDown(down: boolean) {
      networkDown = down;
    },
    /** Changes the caller's role on the server (a role changed while the page is open). */
    setRole(next: Role) {
      role = next;
    },
  };
}
