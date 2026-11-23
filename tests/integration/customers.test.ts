import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { supabaseCustomerService as service } from '../../src/features/customers/supabaseCustomerService';
import { supabaseLedgerService as ledger } from '../../src/features/ledger/supabaseLedgerService';
import { localSupabase, memoryClient, runSql, runSqlInBackground } from './localSupabase';

// The service under test talks to whichever signed-in client the test sets here.
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
// Customers are never deleted: every run uses names of its own, so it can repeat without db:reset.
const SUFFIX = randomBytes(4).toString('hex');

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = memoryClient(local.url, local.publishableKey);
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

function rowsWithOperation(operationId: string): string {
  return runSql(`select count(*) from app.customers where create_operation_id = :'op'::uuid;`, {
    op: operationId,
  });
}

/**
 * Customers this run leaves in the search: erased at the end, so runs repeated without db:reset
 * do not pile up rows ahead of the e2e searches (which show 20 rows).
 */
const toErase: string[] = [];

let adminClient: SupabaseClient;
let operatorClient: SupabaseClient;

beforeAll(async () => {
  adminClient = await signedIn('admin@example.com');
  operatorClient = await signedIn('operatore@example.com');
});

afterAll(async () => {
  current.client = adminClient;
  await Promise.all(toErase.map((id) => service.anonymize(id)));
});

describe('operator', () => {
  const operationId = randomUUID();
  const name = `Nicolò Integrazione ${SUFFIX}`;
  let createdId = '';

  beforeAll(() => {
    current.client = operatorClient;
  });

  it('creates a customer with name, phone and consent; the phone is saved in E.164', async () => {
    const created = await service.create({
      operationId,
      name,
      phone: '333 000 0009',
      email: '',
      privacyConsent: true,
      notes: '  ',
    });
    expect(created).toMatchObject({
      name,
      phone: '+393330000009',
      notes: null,
      anonymizedAt: null,
      balance: 0,
    });
    createdId = created.id;
    toErase.push(created.id);
  });

  it('a resend with the same operation_id returns the same customer, and only one row', async () => {
    const again = await service.create({
      operationId,
      name,
      phone: '333 000 0009',
      email: '',
      privacyConsent: true,
      notes: '',
    });
    expect(again.id).toBe(createdId);
    expect(rowsWithOperation(operationId)).toBe('1');
  });

  it('lists it filtered by name without accents', async () => {
    const page = await service.list({ query: `nicolo integrazione ${SUFFIX}`, after: null });
    expect(page.customers.map((customer) => customer.id)).toEqual([createdId]);
    expect(page.hasMore).toBe(false);
  });

  it('reads it back with get, and null for an id that does not exist', async () => {
    await expect(service.get(createdId)).resolves.toMatchObject({ id: createdId, name });
    await expect(service.get(randomUUID())).resolves.toBeNull();
  });

  it('an equivalent name is customer_name_taken with the existing id', async () => {
    await expect(
      service.create({
        operationId: randomUUID(),
        name: `NICOLO  integrazione ${SUFFIX}`,
        phone: '',
        email: '',
        privacyConsent: true,
        notes: '',
      }),
    ).rejects.toMatchObject({ kind: 'customer_name_taken', existingCustomerId: createdId });
  });

  it('validation refusals come back as their codes', async () => {
    const base = {
      operationId: randomUUID(),
      name,
      phone: '',
      email: '',
      privacyConsent: true,
      notes: '',
    };
    await expect(
      service.create({ ...base, name: `Senza consenso ${SUFFIX}`, privacyConsent: false }),
    ).rejects.toMatchObject({ kind: 'consent_required' });
    await expect(
      service.create({ ...base, name: `Telefono ${SUFFIX}`, phone: '12' }),
    ).rejects.toMatchObject({ kind: 'phone_invalid' });
    await expect(service.create({ ...base, name: '   ' })).rejects.toMatchObject({
      kind: 'name_required',
    });
  });

  it('updates the phone to blank, which removes it', async () => {
    const updated = await service.update({
      id: createdId,
      name,
      phone: '',
      email: '',
      notes: 'Tavolo 4',
    });
    expect(updated).toMatchObject({ id: createdId, phone: null, notes: 'Tavolo 4' });
    await expect(
      service.update({ id: randomUUID(), name, phone: '', email: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_not_found' });
  });

  it('is refused by anonymize_customer with forbidden, and the customer is unchanged', async () => {
    await expect(service.anonymize(createdId)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(service.get(createdId)).resolves.toMatchObject({ name, anonymizedAt: null });
  });

  it('list gives the last activity after a purchase today, with the real balance', async () => {
    // Other customers may be served on this stack (e2e runs): only ours is checked, by its name.
    const ours = async () =>
      (await service.list({ query: name, after: null })).customers.find(
        (customer) => customer.id === createdId,
      );
    await expect(ours()).resolves.toMatchObject({ lastActivityAt: null });
    await ledger.recordPurchase({
      operationId: randomUUID(),
      customerId: createdId,
      amountCents: 1250,
    });

    const served = await ours();
    expect(served).toMatchObject({ id: createdId, balance: 12 });
    expect(served?.lastActivityAt).not.toBeNull();
  });
});

describe('email (customers-v2)', () => {
  const email = `maria.${SUFFIX}@example.com`;
  const base = { phone: '', privacyConsent: true, notes: '' };

  beforeAll(() => {
    current.client = operatorClient;
  });

  it('create stores it normalized; get returns it; the same email is taken with its id', async () => {
    const created = await service.create({
      ...base,
      operationId: randomUUID(),
      name: `Email Prima ${SUFFIX}`,
      email: `  ${email.toUpperCase()} `,
    });
    toErase.push(created.id);
    expect(created.email).toBe(email);
    await expect(service.get(created.id)).resolves.toMatchObject({ email });

    await expect(
      service.create({
        ...base,
        operationId: randomUUID(),
        name: `Email Seconda ${SUFFIX}`,
        email,
      }),
    ).rejects.toMatchObject({ kind: 'customer_email_taken', existingCustomerId: created.id });
    await expect(
      service.create({
        ...base,
        operationId: randomUUID(),
        name: `Email Seconda ${SUFFIX}`,
        email: 'maria@rossi',
      }),
    ).rejects.toMatchObject({ kind: 'email_invalid', existingCustomerId: null });
  });

  it('update keeps its own email, a blank email removes it, and frees it for another', async () => {
    const owner = await service.create({
      ...base,
      operationId: randomUUID(),
      name: `Email Terza ${SUFFIX}`,
      email: `terza.${SUFFIX}@example.com`,
    });
    toErase.push(owner.id);
    const update = { ...base, id: owner.id, name: owner.name };

    await expect(
      service.update({ ...update, email: `Terza.${SUFFIX}@Example.com` }),
    ).resolves.toMatchObject({ email: `terza.${SUFFIX}@example.com` });
    await expect(service.update({ ...update, email: '' })).resolves.toMatchObject({
      email: null,
    });
    const other = await service.create({
      ...base,
      operationId: randomUUID(),
      name: `Email Quarta ${SUFFIX}`,
      email: `terza.${SUFFIX}@example.com`,
    });
    toErase.push(other.id);
    expect(other.email).toBe(`terza.${SUFFIX}@example.com`);
  });

  it('the anonymization clears the email and frees it', async () => {
    const erased = await service.create({
      ...base,
      operationId: randomUUID(),
      name: `Email Cancellata ${SUFFIX}`,
      email: `cancellata.${SUFFIX}@example.com`,
    });
    current.client = adminClient;
    await expect(service.anonymize(erased.id)).resolves.toMatchObject({ email: null });
    current.client = operatorClient;
    const reused = await service.create({
      ...base,
      operationId: randomUUID(),
      name: `Email Riusata ${SUFFIX}`,
      email: `cancellata.${SUFFIX}@example.com`,
    });
    toErase.push(reused.id);
    expect(reused.email).toBe(`cancellata.${SUFFIX}@example.com`);
  });
});

describe('admin', () => {
  const name = `Cliente Da Cancellare ${SUFFIX}`;

  beforeAll(() => {
    current.client = adminClient;
  });

  it('anonymizes a customer: data erased, gone from search, still readable by id', async () => {
    const created = await service.create({
      operationId: randomUUID(),
      name,
      phone: '333 000 0008',
      email: '',
      privacyConsent: true,
      notes: 'Nota di prova',
    });

    const erased = await service.anonymize(created.id);
    expect(erased).toMatchObject({
      id: created.id,
      name: `Cliente cancellato ${created.id.slice(0, 8)}`,
      phone: null,
      notes: null,
    });
    expect(erased.anonymizedAt).not.toBeNull();

    // Repeating it changes nothing.
    await expect(service.anonymize(created.id)).resolves.toEqual(erased);
    await expect(service.list({ query: `da cancellare ${SUFFIX}`, after: null })).resolves.toEqual({
      customers: [],
      hasMore: false,
    });
    await expect(service.get(created.id)).resolves.toEqual(erased);
    // An anonymized customer cannot be edited.
    await expect(
      service.update({ id: created.id, name, phone: '', email: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_anonymized' });
  });
});

/**
 * Two phones saving at the same moment: the pre-check of the RPC does not see a row another
 * transaction has inserted but not committed yet, so the INSERT or UPDATE waits on the unique
 * index and then hits unique_violation. The RPC must settle it with the constraint it hit, never
 * with a raw 23505 (which the app would show as a network error).
 */
describe('concurrent saves', () => {
  const HOLD_SECONDS = '1.5';

  beforeAll(() => {
    current.client = operatorClient;
  });

  /**
   * Inserts a customer in a transaction kept open for HOLD_SECONDS and resolves once the row is
   * inserted (the session is sleeping); `done` settles when it has committed.
   */
  async function holdInsert(row: { id: string; name: string; operationId: string }) {
    const marker = `race-${randomUUID()}`;
    const done = runSqlInBackground(
      `begin;
       insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
       values (:'id'::uuid, :'name', now(),
               (select id from app.operators order by created_at limit 1),
               :'op'::uuid);
       select pg_sleep(${HOLD_SECONDS}) /* ${marker} */;
       commit;`,
      { id: row.id, name: row.name, op: row.operationId },
    );
    await vi.waitFor(
      () => {
        const sleeping = runSql(
          `select count(*) from pg_stat_activity
           where pid <> pg_backend_pid() and query like '%pg_sleep%' and query like :'pattern';`,
          { pattern: `%${marker}%` },
        );
        if (sleeping !== '1') throw new Error('The held transaction has not inserted its row yet');
      },
      { timeout: 2000, interval: 20 },
    );
    return { done };
  }

  it('create: the same name committed meanwhile is customer_name_taken with its id', async () => {
    const held = { id: randomUUID(), name: `Gara Nome ${SUFFIX}`, operationId: randomUUID() };
    const { done } = await holdInsert(held);
    toErase.push(held.id);
    const attempt = service.create({
      operationId: randomUUID(),
      name: held.name,
      phone: '',
      email: '',
      privacyConsent: true,
      notes: '',
    });
    await expect(attempt).rejects.toMatchObject({
      kind: 'customer_name_taken',
      existingCustomerId: held.id,
    });
    await done;
  });

  it('create: the same operation_id committed meanwhile returns that customer', async () => {
    const held = { id: randomUUID(), name: `Gara Invio ${SUFFIX}`, operationId: randomUUID() };
    const { done } = await holdInsert(held);
    toErase.push(held.id);
    const again = await service.create({
      operationId: held.operationId,
      name: `Gara Invio Doppio ${SUFFIX}`,
      phone: '',
      email: '',
      privacyConsent: true,
      notes: '',
    });
    expect(again).toMatchObject({ id: held.id, name: held.name });
    await done;
    expect(rowsWithOperation(held.operationId)).toBe('1');
  });

  it('update: a name committed meanwhile is customer_name_taken with its id', async () => {
    const renamed = await service.create({
      operationId: randomUUID(),
      name: `Gara Rinomina ${SUFFIX}`,
      phone: '',
      email: '',
      privacyConsent: true,
      notes: '',
    });
    toErase.push(renamed.id);
    const held = { id: randomUUID(), name: `Gara Presa ${SUFFIX}`, operationId: randomUUID() };
    const { done } = await holdInsert(held);
    toErase.push(held.id);
    await expect(
      service.update({ id: renamed.id, name: held.name, phone: '', email: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_name_taken', existingCustomerId: held.id });
    await done;
    await expect(service.get(renamed.id)).resolves.toMatchObject({
      name: `Gara Rinomina ${SUFFIX}`,
    });
  });
});

describe('without an active profile', () => {
  // A throwaway Auth user with no operator profile, so the seed accounts are never touched.
  const email = `senza-profilo-${randomUUID()}@example.com`;
  const password = randomBytes(18).toString('base64url');
  const secret = memoryClient(local.url, local.secretKey);
  let userId: string | undefined;

  beforeAll(async () => {
    const { data, error } = await secret.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  });

  afterAll(async () => {
    if (userId) await secret.auth.admin.deleteUser(userId);
  });

  it('every call is not_operator, reads included', async () => {
    const client = memoryClient(local.url, local.publishableKey);
    const { error } = await client.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    current.client = client;
    const notOperator = { kind: 'not_operator' };
    await expect(service.list({ query: 'rossi', after: null })).rejects.toMatchObject(notOperator);
    await expect(service.list({ query: '', after: null })).rejects.toMatchObject(notOperator);
    await expect(service.get(randomUUID())).rejects.toMatchObject(notOperator);
    await expect(
      service.create({
        operationId: randomUUID(),
        name: `Senza profilo ${SUFFIX}`,
        phone: '',
        email: '',
        privacyConsent: true,
        notes: '',
      }),
    ).rejects.toMatchObject(notOperator);
  });

  it('a server that cannot be reached is network', async () => {
    // Port 9 (discard) on the loopback: nothing listens there, the fetch fails at once.
    current.client = memoryClient('http://127.0.0.1:9', local.publishableKey);
    await expect(service.list({ query: 'rossi', after: null })).rejects.toMatchObject({
      kind: 'network',
    });
  });
});
