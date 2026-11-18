import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { supabaseCardsService as cards } from '../../src/features/cards/supabaseCardsService';
import { supabaseCustomerService as customers } from '../../src/features/customers/supabaseCustomerService';
import { supabaseLedgerService as ledger } from '../../src/features/ledger/supabaseLedgerService';
import { supabaseExportService as service } from '../../src/features/export/supabaseExportService';
import { localSupabase, memoryClient } from './localSupabase';

// The services under test talk to whichever signed-in client the test selected.
const current = vi.hoisted(() => ({ client: undefined as SupabaseClient | undefined }));
vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => {
    if (!current.client) throw new Error('No client selected for this test');
    return current.client;
  },
}));

const local = localSupabase();
// Seed accounts (supabase/seed.sql): signing in does not change them.
const SEED_PASSWORD = 'password-di-prova';
// Customers and movements are never deleted: every run uses names of its own.
const SUFFIX = randomBytes(4).toString('hex');

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = memoryClient(local.url, local.publishableKey);
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

let adminClient: SupabaseClient;
let operatorClient: SupabaseClient;

/** Calls `call` with `client` as the signed-in account. */
function as<T>(client: SupabaseClient, call: () => Promise<T>): Promise<T> {
  current.client = client;
  return call();
}

type ExportRpc = 'export_customers' | 'export_movements';

/**
 * Calls an export RPC over plain HTTP, as the app does, and returns the raw answer: the body is
 * read as text, before any parsing, so a test can look for strings that must never leave the server.
 */
async function rawRpc(
  client: SupabaseClient,
  fn: ExportRpc,
  args: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('No session for this client');
  const response = await fetch(`${local.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: local.publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'app',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { status: response.status, body: await response.text() };
}

/** The keyset fields of the rows in an export body: `created_at` exactly as the server wrote it. */
type KeyRow = { id: string; created_at: string };

function keyRowsOf(body: string): KeyRow[] {
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) throw new Error('An export body is not an array');
  return parsed.map((row: unknown) => {
    if (typeof row !== 'object' || row === null) throw new Error('An export row is not an object');
    const id: unknown = Reflect.get(row, 'id');
    const createdAt: unknown = Reflect.get(row, 'created_at');
    if (typeof id !== 'string' || typeof createdAt !== 'string') {
      throw new Error('An export row has no id or created_at');
    }
    return { id, created_at: createdAt };
  });
}

const idsOf = (body: string) => keyRowsOf(body).map((row) => row.id);

/** The rows of an export body, every field as the server wrote it. */
function rowsOf(body: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) throw new Error('An export body is not an array');
  return parsed.map((row: unknown) => {
    if (typeof row !== 'object' || row === null) throw new Error('An export row is not an object');
    return Object.fromEntries(Object.entries(row));
  });
}

/** Every page of an export RPC over HTTP (1000 rows each): the raw bodies, in order. */
async function allRawPages(fn: ExportRpc): Promise<string[]> {
  const bodies: string[] = [];
  let args: Record<string, unknown> = { p_limit: 1000 };
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the cursor of the one before it.
    const { status, body } = await rawRpc(adminClient, fn, args);
    expect(status).toBe(200);
    bodies.push(body);
    const rows = keyRowsOf(body);
    const last = rows.at(-1);
    if (rows.length < 1000 || !last) return bodies;
    args =
      fn === 'export_customers'
        ? { p_after_id: last.id, p_limit: 1000 }
        : { p_after_created_at: last.created_at, p_after_id: last.id, p_limit: 1000 };
  }
}

/** Customers this run leaves readable: anonymized at the end. */
const toErase: string[] = [];

beforeAll(async () => {
  adminClient = await signedIn('admin@example.com');
  operatorClient = await signedIn('operatore@example.com');
});

afterAll(async () => {
  current.client = adminClient;
  await Promise.all(toErase.map((id) => customers.anonymize(id)));
});

describe('an operator (criterion 2)', () => {
  it('gets 42501 from both RPCs over HTTP', async () => {
    const customersAnswer = await rawRpc(operatorClient, 'export_customers', { p_limit: 10 });
    const movementsAnswer = await rawRpc(operatorClient, 'export_movements', { p_limit: 10 });

    for (const answer of [customersAnswer, movementsAnswer]) {
      expect(answer.status).toBe(403);
      expect(JSON.parse(answer.body)).toMatchObject({ code: '42501', message: 'forbidden' });
    }
  });

  it('is refused by the export service with forbidden, not with a server fault', async () => {
    await expect(as(operatorClient, () => service.fetchCustomers())).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(as(operatorClient, () => service.fetchMovements())).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });
});

describe('an admin', () => {
  let customerId: string;

  beforeAll(async () => {
    const created = await as(operatorClient, () =>
      customers.create({
        operationId: randomUUID(),
        name: `Esporta Leggibile ${SUFFIX}`,
        phone: '',
        privacyConsent: true,
        notes: '',
      }),
    );
    customerId = created.id;
    toErase.push(customerId);
    await as(operatorClient, () =>
      ledger.recordPurchase({ operationId: randomUUID(), customerId, amountCents: 1250 }),
    );
  });

  it('reads customers in keyset pages with a small limit, without gaps or repeats', async () => {
    const first = await rawRpc(adminClient, 'export_customers', { p_limit: 2 });
    const firstRows = keyRowsOf(first.body);
    const lastOfFirst = firstRows.at(-1);
    if (!lastOfFirst) throw new Error('The stack has no customers');
    const second = await rawRpc(adminClient, 'export_customers', {
      p_after_id: lastOfFirst.id,
      p_limit: 2,
    });
    const both = await rawRpc(adminClient, 'export_customers', { p_limit: 4 });

    expect([first.status, second.status, both.status]).toEqual([200, 200, 200]);
    const ids = [...firstRows.map((row) => row.id), ...idsOf(second.body)];
    expect(ids).toEqual(idsOf(both.body));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads movements in keyset pages with a small limit, the cursor sent back as received', async () => {
    const first = await rawRpc(adminClient, 'export_movements', { p_limit: 2 });
    const firstRows = keyRowsOf(first.body);
    const lastOfFirst = firstRows.at(-1);
    if (!lastOfFirst) throw new Error('The stack has no movements');
    const second = await rawRpc(adminClient, 'export_movements', {
      p_after_created_at: lastOfFirst.created_at,
      p_after_id: lastOfFirst.id,
      p_limit: 2,
    });
    const both = await rawRpc(adminClient, 'export_movements', { p_limit: 4 });

    expect([first.status, second.status, both.status]).toEqual([200, 200, 200]);
    const ids = [...firstRows.map((row) => row.id), ...idsOf(second.body)];
    expect(ids).toEqual(idsOf(both.body));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads every page through the export service, this run’s customer and purchase included', async () => {
    const rows = await as(adminClient, () => service.fetchCustomers());
    expect(rows).toContainEqual(
      expect.objectContaining({
        id: customerId,
        name: `Esporta Leggibile ${SUFFIX}`,
        balancePoints: 12,
        anonymizedAt: null,
      }),
    );
    const movements = await as(adminClient, () => service.fetchMovements());
    expect(movements).toContainEqual(
      expect.objectContaining({
        customerId,
        customerName: `Esporta Leggibile ${SUFFIX}`,
        kind: 'purchase',
        amountCents: 1250,
        points: 12,
        operatorName: 'Operatore Prova',
      }),
    );
    expect(new Set(movements.map((movement) => movement.id)).size).toBe(movements.length);
  });
});

describe('an anonymized customer (criterion 5)', () => {
  // Plain ASCII, so the JSON body spells them exactly like this.
  const name = `Nome Riservato Export ${SUFFIX}`;
  const notes = `Nota riservata export ${SUFFIX}`;
  // Fake Italian mobile number and card uid, random so that runs never collide.
  const phoneDigits = `333${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, '0')}`;
  const uid = `04${randomBytes(6).toString('hex').toUpperCase()}`;
  let customerId: string;

  beforeAll(async () => {
    const created = await as(operatorClient, () =>
      customers.create({
        operationId: randomUUID(),
        name,
        phone: phoneDigits,
        privacyConsent: true,
        notes,
      }),
    );
    customerId = created.id;
    await as(operatorClient, () => cards.associate(customerId, uid));
    await as(operatorClient, () =>
      ledger.recordPurchase({ operationId: randomUUID(), customerId, amountCents: 1250 }),
    );
    await as(adminClient, () => customers.anonymize(customerId));
  });

  it('is in both exports, with every personal field null in the HTTP bodies', async () => {
    const customerBodies = await allRawPages('export_customers');
    const movementBodies = await allRawPages('export_movements');

    // What the export functions themselves must hide: the anonymized row still holds a
    // placeholder name ("Cliente cancellato …") and the card uid stays bound to it.
    const theirRows = customerBodies.flatMap(rowsOf).filter((row) => row.id === customerId);
    expect(theirRows).toHaveLength(1);
    expect(theirRows[0]).toMatchObject({
      name: null,
      phone: null,
      notes: null,
      active_card_uid: null,
    });
    const theirMovements = movementBodies
      .flatMap(rowsOf)
      .filter((row) => row.customer_id === customerId);
    expect(theirMovements).toHaveLength(1);
    expect(theirMovements[0]).toMatchObject({ customer_name: null });

    const placeholder = `Cliente cancellato ${customerId.slice(0, 8)}`;
    for (const body of [...customerBodies, ...movementBodies]) {
      // Booleans, so a failure does not print every row of the stack.
      expect(body.includes(name), 'original name in an HTTP body').toBe(false);
      expect(body.includes(notes), 'original notes in an HTTP body').toBe(false);
      expect(body.includes(phoneDigits), 'phone in an HTTP body').toBe(false);
      expect(body.includes(uid), 'card uid in an HTTP body').toBe(false);
      expect(body.includes(placeholder), 'anonymized placeholder name in an HTTP body').toBe(false);
    }
  });

  it('keeps its balance, with the personal fields null', async () => {
    const rows = await as(adminClient, () => service.fetchCustomers());
    expect(rows.find((row) => row.id === customerId)).toMatchObject({
      name: null,
      phone: null,
      notes: null,
      activeCardUid: null,
      balancePoints: 12,
    });
    const movements = await as(adminClient, () => service.fetchMovements());
    const theirs = movements.filter((movement) => movement.customerId === customerId);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ customerName: null, amountCents: 1250, points: 12 });
  });
});
