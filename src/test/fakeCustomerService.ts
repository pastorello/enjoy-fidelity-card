import { vi } from 'vitest';
import { classifyQuery, normalizePhone } from '../features/customers/phone';
import { CustomerError } from '../features/customers/types';
import type {
  CustomerErrorKind,
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

type FakeOptions = {
  customers?: CustomerSummary[];
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
export function fakeCustomer(overrides: Partial<CustomerSummary> = {}): CustomerSummary {
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
 * unique on the same key as `customer_name_key`, `create` is idempotent on `operationId`, search
 * by name words or phone digits (21 rows at most, never anonymized customers). Every method is a
 * `vi.fn` and every call is also logged in `calls`. `failNext` programs a failure (also an
 * answer lost after the call was applied), `holdNext` delays an answer until released (responses
 * out of order), `setNetworkDown` makes every call fail with `network`.
 */
export function createFakeCustomerService({
  customers: initial = [],
  role = 'admin',
}: FakeOptions = {}) {
  const stored = new Map(initial.map((customer) => [customer.id, copy(customer)]));
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

  const service = {
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
        const existing = stored.get(createdBy.get(input.operationId) ?? '');
        if (existing) return copy(existing);
        const { name, phone, notes } = validate(input, input.privacyConsent);
        const taken = takenBy(name, null);
        if (taken !== null) throw new CustomerError('customer_name_taken', taken);
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
        createdBy.set(input.operationId, customer.id);
        return copy(customer);
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
