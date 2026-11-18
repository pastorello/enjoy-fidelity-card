import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { supabaseCustomerService as service } from '../../src/features/customers/supabaseCustomerService';
import { localSupabase, memoryClient, runSql } from './localSupabase';

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

let adminClient: SupabaseClient;
let operatorClient: SupabaseClient;

beforeAll(async () => {
  adminClient = await signedIn('admin@example.com');
  operatorClient = await signedIn('operatore@example.com');
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
  });

  it('a resend with the same operation_id returns the same customer, and only one row', async () => {
    const again = await service.create({
      operationId,
      name,
      phone: '333 000 0009',
      privacyConsent: true,
      notes: '',
    });
    expect(again.id).toBe(createdId);
    expect(rowsWithOperation(operationId)).toBe('1');
  });

  it('finds it by name without accents and by the phone digits', async () => {
    const byName = await service.search(`nicolo integrazione ${SUFFIX}`);
    expect(byName.map((customer) => customer.id)).toEqual([createdId]);
    const byPhone = await service.search('0000009');
    expect(byPhone.map((customer) => customer.id)).toContain(createdId);
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
        privacyConsent: true,
        notes: '',
      }),
    ).rejects.toMatchObject({ kind: 'customer_name_taken', existingCustomerId: createdId });
  });

  it('validation refusals come back as their codes', async () => {
    const base = { operationId: randomUUID(), name, phone: '', privacyConsent: true, notes: '' };
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
    const updated = await service.update({ id: createdId, name, phone: '', notes: 'Tavolo 4' });
    expect(updated).toMatchObject({ id: createdId, phone: null, notes: 'Tavolo 4' });
    await expect(
      service.update({ id: randomUUID(), name, phone: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_not_found' });
  });

  it('is refused by anonymize_customer with forbidden, and the customer is unchanged', async () => {
    await expect(service.anonymize(createdId)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(service.get(createdId)).resolves.toMatchObject({ name, anonymizedAt: null });
  });

  it('servedToday answers an empty list until ledger exists', async () => {
    await expect(service.servedToday()).resolves.toEqual([]);
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
    await expect(service.search(`da cancellare ${SUFFIX}`)).resolves.toEqual([]);
    await expect(service.get(created.id)).resolves.toEqual(erased);
    // An anonymized customer cannot be edited.
    await expect(
      service.update({ id: created.id, name, phone: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_anonymized' });
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
    await expect(service.search('rossi')).rejects.toMatchObject(notOperator);
    await expect(service.servedToday()).rejects.toMatchObject(notOperator);
    await expect(service.get(randomUUID())).rejects.toMatchObject(notOperator);
    await expect(
      service.create({
        operationId: randomUUID(),
        name: `Senza profilo ${SUFFIX}`,
        phone: '',
        privacyConsent: true,
        notes: '',
      }),
    ).rejects.toMatchObject(notOperator);
  });

  it('a server that cannot be reached is network', async () => {
    // Port 9 (discard) on the loopback: nothing listens there, the fetch fails at once.
    current.client = memoryClient('http://127.0.0.1:9', local.publishableKey);
    await expect(service.search('rossi')).rejects.toMatchObject({ kind: 'network' });
  });
});
