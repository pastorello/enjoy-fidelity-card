import { vi } from 'vitest';
import { normalizeEmail } from '../features/customers/email';
import { normalizePhone } from '../features/customers/phone';
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
 * A stored customer (its email, in the stored form, defaults to none) plus what only the list
 * reads: when it was created (default: a fake clock, one second after the previous customer, so
 * later fixtures are newer) and its last purchase or redemption (default none). ISO strings, as
 * PostgREST sends them.
 */
export type FakeCustomerFixture = Omit<CustomerSummary, 'email'> & {
  email?: string | null;
  createdAt?: string;
  lastActivityAt?: string | null;
};

/** What the list reads besides the summary. */
type ListFields = { createdAt: string; lastActivityAt: string | null };

type FakeOptions = {
  customers?: FakeCustomerFixture[];
  /** The caller's role: an operator gets `forbidden` from `anonymize`, like on the server. */
  role?: 'admin' | 'operator';
};

const NAME_MAX = 80;
const NOTES_MAX = 500;
const SEARCH_MAX_TEXT = 80;
let nextFixture = 0;

/** A UUID-shaped id from a counter, so pages that check the id shape accept it. */
function fakeId(counter: number): string {
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

/** A customer as the server returns it, with a fresh id; for the `customers` option. */
export function fakeCustomer(
  overrides: Partial<FakeCustomerFixture> = {},
): FakeCustomerFixture & CustomerSummary {
  nextFixture += 1;
  return {
    id: fakeId(900_000_000 + nextFixture),
    name: 'Cliente Prova',
    phone: null,
    email: null,
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
  const { id, name, phone, email = null, notes, anonymizedAt, balance, lastServedAt } = fixture;
  return { id, name, phone, email, notes, anonymizedAt, balance, lastServedAt };
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

/**
 * The checks shared by create and update that come before the name's uniqueness, in the server's
 * order; returns the cleaned values. The email is only normalized here: its checks come after.
 */
function validate(
  input: { name: string; phone: string; email: string; notes: string },
  consent = true,
) {
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
  return { name, phone, email: normalizeEmail(input.email), notes };
}

function perMethod<T>(make: () => T): Record<Method, T> {
  return {
    list: make(),
    get: make(),
    create: make(),
    update: make(),
    anonymize: make(),
  };
}

/**
 * In-memory CustomerService for component tests, following the server's rules: the name is
 * unique on the same key as `customer_name_key`, the email is stored as `normalizeEmail` gives it
 * and is unique (the anonymization frees it), `create` is idempotent on `operationId`, `list`
 * pages like `app.list_customers` (order, filter by name words or part of the email, cursor, 20 rows,
 * never anonymized customers). Every method is a
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
        },
      ];
    }),
  );
  const createdBy = new Map<string, string>();
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

  /**
   * The checks after the name's uniqueness, as `private.check_email` and
   * `private.raise_email_taken`: the format, then the customer (not `except`) that has it.
   */
  function checkEmail(email: string | null, except: string | null): string | null {
    if (email === 'invalid') throw new CustomerError('email_invalid');
    if (email === null) return null;
    for (const customer of stored.values()) {
      if (customer.id !== except && customer.email === email) {
        throw new CustomerError('customer_email_taken', customer.id);
      }
    }
    return email;
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
    const { name, phone, email: typedEmail, notes } = validate(input, input.privacyConsent);
    const taken = takenBy(name, null);
    if (taken !== null) throw new CustomerError('customer_name_taken', taken);
    const email = checkEmail(typedEmail, null);
    return () => {
      created += 1;
      const customer: CustomerSummary = {
        id: fakeId(created),
        name,
        phone,
        email,
        notes,
        anonymizedAt: null,
        balance: 0,
        lastServedAt: null,
      };
      stored.set(customer.id, customer);
      ticks += 1;
      listFields.set(customer.id, { createdAt: createdStamp(ticks), lastActivityAt: null });
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
        ({ customer }) =>
          !filtered ||
          nameMatches(customer.name, words) ||
          (customer.email?.includes(email) ?? false),
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
        const { name, phone, email: typedEmail, notes } = validate(input);
        const taken = takenBy(name, customer.id);
        if (taken !== null) throw new CustomerError('customer_name_taken', taken);
        const email = checkEmail(typedEmail, customer.id);
        Object.assign(customer, { name, phone, email, notes });
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
            email: null,
            notes: null,
            anonymizedAt: '2026-11-17T12:00:00.000Z',
          });
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
      }
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
