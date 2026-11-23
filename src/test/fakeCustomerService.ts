import { vi } from 'vitest';
import { classifyQuery, normalizePhone } from '../features/customers/phone';
import { CUSTOMER_LIST_PAGE_SIZE, CustomerError } from '../features/customers/types';
import type {
  CreateCustomerInput,
  CustomerErrorKind,
  CustomerListCursor,
  CustomerListRow,
  CustomerService,
  CustomerSummary,
} from '../features/customers/types';

type Method = keyof CustomerService;

/**
 * What a programmed call does instead of answering: reject with that `CustomerError` kind or
 * that error (a `ServerFaultError`, say) without changing anything, or `'lost'`: the call
 * reaches the server and is applied, but the answer never arrives (rejects with `network`).
 */
export type FakeFailure = CustomerErrorKind | 'lost' | Error;

/** One logged call: the method and the arguments it received. */
export type FakeCustomerCall = { method: Method; args: unknown[] };

/**
 * A stored customer plus what only the list reads: when it was created (default: a fake clock,
 * one second after the previous customer, so later fixtures are newer), its last purchase or
 * redemption (default none) and its email (default none). ISO strings, as PostgREST sends them.
 */
export type FakeCustomerFixture = CustomerSummary & {
  createdAt?: string;
  lastActivityAt?: string | null;
  email?: string | null;
};

/** What the list reads besides the summary. */
type ListFields = { createdAt: string; lastActivityAt: string | null; email: string | null };

type FakeOptions = {
  customers?: FakeCustomerFixture[];
  /** The caller's role: an operator gets `forbidden` from `anonymize`, like on the server. */
  role?: 'admin' | 'operator';
};

const NAME_MAX = 80;
const NOTES_MAX = 500;
const SEARCH_MAX_ROWS = 21;
const SEARCH_MAX_TEXT = 80;
const SERVED_TODAY_MAX = 50;
let nextFixture = 0;

/** A UUID-shaped id from a counter, so pages that check the id shape accept it. */
function fakeId(counter: number): string {
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

/** A customer as the server returns it, with a fresh id; for the `customers` option. */
export function fakeCustomer(overrides: Partial<FakeCustomerFixture> = {}): FakeCustomerFixture {
  nextFixture += 1;
  return {
    id: fakeId(900_000_000 + nextFixture),
    name: 'Cliente Prova',
    phone: null,
    notes: null,
    anonymizedAt: null,
    balance: 0,
    lastServedAt: null,
    ...overrides,
  };
}

/** `private.clean_name`: trimmed, inner spaces collapsed to one. */
function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** `private.customer_name_key`: no case, no accents, `’` read as `'`. */
function nameKey(name: string): string {
  return cleanName(name).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('’', "'");
}

/** Blank → null, like `nullif(btrim(…), '')`. */
function blankToNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

function copy(customer: CustomerSummary): CustomerSummary {
  return { ...customer };
}

/** The summary of a fixture, without the list-only fields. */
function summaryOf(fixture: FakeCustomerFixture): CustomerSummary {
  const { id, name, phone, notes, anonymizedAt, balance, lastServedAt } = fixture;
  return { id, name, phone, notes, anonymizedAt, balance, lastServedAt };
}

/** The fake clock of creation times: `2026-11-01T08:00:00` plus `tick` seconds, with microseconds. */
function createdStamp(tick: number): string {
  const second = new Date(Date.UTC(2026, 10, 1, 8, 0, 0) + tick * 1000).toISOString();
  return `${second.slice(0, 19)}.${String(tick % 1_000_000).padStart(6, '0')}+00:00`;
}

const TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Microseconds since the epoch of an ISO timestamp, so the fake compares them like Postgres
 * (`Date` would drop the microseconds, strings with different offsets or digits would mis-sort).
 */
function micros(timestamp: string): number {
  const match = TIMESTAMP.exec(timestamp);
  if (!match) throw new Error(`fakeCustomerService: not a timestamp: ${timestamp}`);
  const [, seconds = '', fraction = '', zone = ''] = match;
  const offset =
    zone.length === 3
      ? `${zone}:00`
      : zone.length === 5
        ? `${zone.slice(0, 3)}:${zone.slice(3)}`
        : zone;
  return Date.parse(`${seconds}${offset}`) * 1000 + Number(fraction.padEnd(6, '0'));
}

/** `app.list_customers`'s sort key: has activity, coalesce(activity, creation), id. */
type ListKey = { active: boolean; at: number; id: string };

/** Descending order of `app.list_customers`: negative when `a` comes first. */
function compareDesc(a: ListKey, b: ListKey): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  if (a.at !== b.at) return b.at - a.at;
  if (a.id === b.id) return 0;
  return a.id > b.id ? -1 : 1;
}

/** Every word in the name key (substring tests: `%`, `_` and `\` taken literally, as on the server). */
function nameMatches(name: string, words: string[]): boolean {
  const key = nameKey(name);
  return words.every((word) => key.includes(word));
}

function byNameKey(a: CustomerSummary, b: CustomerSummary): number {
  const ka = nameKey(a.name);
  const kb = nameKey(b.name);
  if (ka !== kb) return ka < kb ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** The checks shared by create and update, in the server's order; returns the cleaned values. */
function validate(input: { name: string; phone: string; notes: string }, consent = true) {
  const name = cleanName(input.name);
  if (name === '') throw new CustomerError('name_required');
  if (Array.from(name).length > NAME_MAX) throw new CustomerError('name_too_long');
  const typedPhone = blankToNull(input.phone);
  const phone = typedPhone === null ? null : normalizePhone(typedPhone);
  if (typedPhone !== null && phone === null) throw new CustomerError('phone_invalid');
  if (!consent) throw new CustomerError('consent_required');
  const notes = blankToNull(input.notes);
  if (notes !== null && Array.from(notes).length > NOTES_MAX) {
    throw new CustomerError('notes_too_long');
  }
  return { name, phone, notes };
}

function perMethod<T>(make: () => T): Record<Method, T> {
  return {
    list: make(),
    search: make(),
    servedToday: make(),
    get: make(),
    create: make(),
    update: make(),
    anonymize: make(),
  };
}

/**
 * In-memory CustomerService for component tests, following the server's rules: the name is
 * unique on the same key as `customer_name_key`, `create` is idempotent on `operationId`, `list`
 * pages like `app.list_customers` (order, filter by name words or part of the email, cursor, 20 rows),
 * search by name words or phone digits (21 rows at most, never anonymized customers). Every method is a
 * `vi.fn` and every call is also logged in `calls`. `failNext` programs a failure (also an
 * answer lost after the call was applied), `holdNext` delays an answer until released (responses
 * out of order), `setNetworkDown` makes every call fail with `network`.
 */
export function createFakeCustomerService({
  customers: initial = [],
  role = 'admin',
}: FakeOptions = {}) {
  const stored = new Map(initial.map((customer) => [customer.id, summaryOf(customer)]));
  let ticks = 0;
  const listFields = new Map<string, ListFields>(
    initial.map((customer) => {
      ticks += 1;
      return [
        customer.id,
        {
          createdAt: customer.createdAt ?? createdStamp(ticks),
          lastActivityAt: customer.lastActivityAt ?? null,
          email: customer.email ?? null,
        },
      ];
    }),
  );
  const createdBy = new Map<string, string>();
  let servedTodayIds: string[] = [];
  let created = 0;
  let networkDown = false;
  const failures = perMethod<FakeFailure[]>(() => []);
  const holds = perMethod<Promise<void>[]>(() => []);
  const calls: FakeCustomerCall[] = [];

  function takenBy(name: string, except: string | null): string | null {
    const key = nameKey(name);
    for (const customer of stored.values()) {
      if (customer.id !== except && nameKey(customer.name) === key) return customer.id;
    }
    return null;
  }

  /** The customer a create with this `operationId` made, or null. */
  function createdFor(operationId: string): CustomerSummary | null {
    const existing = stored.get(createdBy.get(operationId) ?? '');
    return existing ? copy(existing) : null;
  }

  /**
   * The checks of the server create (throwing its `CustomerError`), then a function that stores
   * the customer: `fakeCardsService` runs the card checks in between, all or nothing.
   */
  function prepareCreate(input: CreateCustomerInput): () => CustomerSummary {
    const { name, phone, notes } = validate(input, input.privacyConsent);
    const taken = takenBy(name, null);
    if (taken !== null) throw new CustomerError('customer_name_taken', taken);
    return () => {
      created += 1;
      const customer: CustomerSummary = {
        id: fakeId(created),
        name,
        phone,
        notes,
        anonymizedAt: null,
        balance: 0,
        lastServedAt: null,
      };
      stored.set(customer.id, customer);
      ticks += 1;
      listFields.set(customer.id, {
        createdAt: createdStamp(ticks),
        lastActivityAt: null,
        email: null,
      });
      createdBy.set(input.operationId, customer.id);
      return copy(customer);
    };
  }

  /** Logs the call, then answers it as programmed (network, failure, hold) or with `compute`. */
  function run<T>(method: Method, args: unknown[], compute: () => T): Promise<T> {
    calls.push({ method, args });
    const failure = failures[method].shift();
    const hold = holds[method].shift();
    const down = networkDown;
    // Built only when it is due, so a held rejection is never left unhandled meanwhile.
    const answer = async () => {
      if (down) throw new CustomerError('network');
      if (failure instanceof Error) throw failure;
      if (failure !== undefined && failure !== 'lost') throw new CustomerError(failure);
      const result = compute();
      if (failure === 'lost') throw new CustomerError('network');
      return result;
    };
    return hold ? hold.then(answer) : answer();
  }

  function search(query: string): CustomerSummary[] {
    const text = cleanName(query.slice(0, SEARCH_MAX_TEXT));
    const kind = classifyQuery(text);
    if (kind === 'none') return [];
    const visible = [...stored.values()].filter((customer) => customer.anonymizedAt === null);
    let found: CustomerSummary[];
    if (kind === 'phone') {
      let digits = text.replace(/[\s+.-]/g, '');
      if (digits.startsWith('00')) digits = digits.slice(2);
      found = visible.filter((customer) => customer.phone?.includes(digits));
    } else {
      const words = text.split(' ').map(nameKey);
      found = visible.filter((customer) =>
        words.every((word) => nameKey(customer.name).includes(word)),
      );
    }
    return found.toSorted(byNameKey).slice(0, SEARCH_MAX_ROWS).map(copy);
  }

  function fieldsOf(id: string): ListFields {
    const fields = listFields.get(id);
    if (!fields) throw new Error('fakeCustomerService: a customer without list fields');
    return fields;
  }

  function listKey(id: string, fields: ListFields): ListKey {
    const { lastActivityAt, createdAt } = fields;
    return { active: lastActivityAt !== null, at: micros(lastActivityAt ?? createdAt), id };
  }

  /** `app.list_customers`: same filter, order, cursor and page size. */
  function list(query: string, after: CustomerListCursor | null): CustomerListRow[] {
    const text = cleanName(query.slice(0, SEARCH_MAX_TEXT));
    const filtered = Array.from(text).length >= 2;
    const words = text.split(' ').map(nameKey);
    const email = text.toLowerCase();
    const bound: ListKey | null = after && {
      active: after.activityAt !== null,
      at: micros(after.activityAt ?? after.createdAt),
      id: after.id,
    };
    return [...stored.values()]
      .filter((customer) => customer.anonymizedAt === null)
      .map((customer) => ({ customer, fields: fieldsOf(customer.id) }))
      .filter(
        ({ customer, fields }) =>
          !filtered ||
          nameMatches(customer.name, words) ||
          (fields.email?.includes(email) ?? false),
      )
      .map((entry) => ({ ...entry, key: listKey(entry.customer.id, entry.fields) }))
      .filter(({ key }) => bound === null || compareDesc(key, bound) > 0)
      .toSorted((a, b) => compareDesc(a.key, b.key))
      .slice(0, CUSTOMER_LIST_PAGE_SIZE)
      .map(({ customer, fields }) => ({
        id: customer.id,
        name: customer.name,
        balance: customer.balance,
        lastActivityAt: fields.lastActivityAt,
        createdAt: fields.createdAt,
      }));
  }

  const service = {
    list: vi.fn<CustomerService['list']>((input) =>
      run('list', [input], () => {
        const customers = list(input.query, input.after);
        return { customers, hasMore: customers.length === CUSTOMER_LIST_PAGE_SIZE };
      }),
    ),
    search: vi.fn<CustomerService['search']>((query) =>
      run('search', [query], () => search(query)),
    ),
    servedToday: vi.fn<CustomerService['servedToday']>(() =>
      run('servedToday', [], () =>
        servedTodayIds
          .flatMap((id) => {
            const customer = stored.get(id);
            return customer && customer.anonymizedAt === null ? [copy(customer)] : [];
          })
          .slice(0, SERVED_TODAY_MAX),
      ),
    ),
    get: vi.fn<CustomerService['get']>((id) =>
      run('get', [id], () => {
        const customer = stored.get(id);
        return customer ? copy(customer) : null;
      }),
    ),
    create: vi.fn<CustomerService['create']>((input) =>
      run('create', [input], () => {
        // A resent request returns what the first one created, before any check.
        return createdFor(input.operationId) ?? prepareCreate(input)();
      }),
    ),
    update: vi.fn<CustomerService['update']>((input) =>
      run('update', [input], () => {
        const customer = stored.get(input.id);
        if (!customer) throw new CustomerError('customer_not_found');
        if (customer.anonymizedAt !== null) throw new CustomerError('customer_anonymized');
        const { name, phone, notes } = validate(input);
        const taken = takenBy(name, customer.id);
        if (taken !== null) throw new CustomerError('customer_name_taken', taken);
        Object.assign(customer, { name, phone, notes });
        return copy(customer);
      }),
    ),
    anonymize: vi.fn<CustomerService['anonymize']>((id) =>
      run('anonymize', [id], () => {
        if (role !== 'admin') throw new CustomerError('forbidden');
        const customer = stored.get(id);
        if (!customer) throw new CustomerError('customer_not_found');
        if (customer.anonymizedAt === null) {
          Object.assign(customer, {
            name: `Cliente cancellato ${id.slice(0, 8)}`,
            phone: null,
            notes: null,
            anonymizedAt: '2026-11-17T12:00:00.000Z',
          });
          fieldsOf(id).email = null;
        }
        return copy(customer);
      }),
    ),
  } satisfies CustomerService;

  return {
    service,
    /** Every call, in order, with its arguments. */
    calls,
    /** The stored customers, as copies. */
    customers: () => [...stored.values()].map(copy),
    /** For `fakeCardsService` (new customer with a card): not logged, not programmable. */
    createdFor,
    prepareCreate,
    /**
     * For `fakeLedgerService`: adds a movement's points to the balance and, for a purchase or a
     * redemption (`servedAt` set), makes the customer the most recently served today and moves its
     * last activity forward (never back, like the server's trigger), so it tops the list. Not
     * logged, not programmable.
     */
    applyMovement(customerId: string, points: number, servedAt: string | null) {
      const customer = stored.get(customerId);
      if (!customer) throw new Error('fakeCustomerService: a movement of a missing customer');
      customer.balance += points;
      if (servedAt !== null) {
        customer.lastServedAt = servedAt;
        const fields = fieldsOf(customerId);
        if (fields.lastActivityAt === null || micros(servedAt) > micros(fields.lastActivityAt)) {
          fields.lastActivityAt = servedAt;
        }
        servedTodayIds = [customerId, ...servedTodayIds.filter((id) => id !== customerId)];
      }
    },
    /** The customers served today, most recent first (until `ledger`, the server's list is empty). */
    setServedToday(ids: string[]) {
      servedTodayIds = [...ids];
    },
    /** Programs the next call of `method` (queued: one failure per call, in order). */
    failNext(method: Method, failure: FakeFailure) {
      failures[method].push(failure);
    },
    /** Delays the answer of the next call of `method` until `release()`. */
    holdNext(method: Method) {
      let release!: () => void;
      holds[method].push(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return { release };
    },
    /** While down, every call rejects with `network` and changes nothing. */
    setNetworkDown(down: boolean) {
      networkDown = down;
    },
  };
}
