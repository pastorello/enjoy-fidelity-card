import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../lib/serverFault';
import { CustomerError } from '../features/customers/types';
import type { CreateCustomerInput } from '../features/customers/types';
import { createFakeCustomerService, fakeCustomer } from './fakeCustomerService';

const OP_1 = '11111111-1111-4111-8111-111111111111';
const OP_2 = '22222222-2222-4222-8222-222222222222';

function newCustomer(overrides: Partial<CreateCustomerInput> = {}): CreateCustomerInput {
  return {
    operationId: OP_1,
    name: 'Maria Rossi',
    phone: '',
    email: '',
    privacyConsent: true,
    notes: '',
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

describe('createFakeCustomerService', () => {
  it('creates a customer that get and list then find, normalizing name and phone', async () => {
    const { service } = createFakeCustomerService();
    const created = await service.create(
      newCustomer({ name: '  Maria   Rossi ', phone: '333 123 4521', notes: '  Al banco ' }),
    );

    expect(created).toMatchObject({
      name: 'Maria Rossi',
      phone: '+393331234521',
      notes: 'Al banco',
      anonymizedAt: null,
      balance: 0,
      lastServedAt: null,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(service.get(created.id)).resolves.toEqual(created);
    await expect(service.list({ query: 'rossi maria', after: null }).then(names)).resolves.toEqual([
      'Maria Rossi',
    ]);
  });

  it('refuses an equivalent name (case, accents, apostrophes, spaces) with the existing id', async () => {
    const existing = fakeCustomer({ name: "Nicolò D'Angelo" });
    const { service } = createFakeCustomerService({ customers: [existing] });

    const error = await rejection(service.create(newCustomer({ name: 'nicolo   D’ANGELO' })));
    expect(error).toBeInstanceOf(CustomerError);
    expect(error).toMatchObject({ kind: 'customer_name_taken', existingCustomerId: existing.id });

    const other = await service.create(newCustomer({ operationId: OP_2, name: 'Luca Bianchi' }));
    await expect(
      service.update({ id: other.id, name: 'NICOLO d’angelo', phone: '', email: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_name_taken', existingCustomerId: existing.id });
    // Renaming a customer to another spelling of its own name is fine.
    await expect(
      service.update({ id: existing.id, name: 'Nicolo D’Angelo', phone: '', email: '', notes: '' }),
    ).resolves.toMatchObject({ name: 'Nicolo D’Angelo' });
  });

  it('the same operation_id returns the same customer and creates it once', async () => {
    const { service, customers } = createFakeCustomerService();
    const first = await service.create(newCustomer());
    const again = await service.create(newCustomer({ name: 'Altro Nome' }));

    expect(again).toEqual(first);
    expect(customers()).toHaveLength(1);
    expect(service.create).toHaveBeenCalledTimes(2);
  });

  it('validates like the server', async () => {
    const { service } = createFakeCustomerService();
    const kind = async (input: Partial<CreateCustomerInput>) => {
      const error = await rejection(service.create(newCustomer(input)));
      return error instanceof CustomerError ? error.kind : error;
    };

    expect(await kind({ name: '   ' })).toBe('name_required');
    expect(await kind({ name: 'x'.repeat(81) })).toBe('name_too_long');
    expect(await kind({ phone: '12ab' })).toBe('phone_invalid');
    expect(await kind({ privacyConsent: false })).toBe('consent_required');
    expect(await kind({ notes: 'n'.repeat(501) })).toBe('notes_too_long');
    await expect(service.create(newCustomer({ name: 'x'.repeat(80) }))).resolves.toBeDefined();
  });

  it('update clears a blank phone, refuses unknown and anonymized customers', async () => {
    const kept = fakeCustomer({ name: 'Anna Verdi', phone: '+393331234521' });
    const erased = fakeCustomer({ name: 'Cliente cancellato abcdef12', anonymizedAt: 'x' });
    const { service } = createFakeCustomerService({ customers: [kept, erased] });

    await expect(
      service.update({ id: kept.id, name: 'Anna Verdi', phone: ' ', email: '', notes: '' }),
    ).resolves.toMatchObject({ phone: null, notes: null });
    await expect(
      service.update({ id: erased.id, name: 'Nuovo', phone: '', email: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_anonymized' });
    await expect(
      service.update({ id: OP_2, name: 'Nuovo', phone: '', email: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_not_found' });
    await expect(service.get(OP_2)).resolves.toBeNull();
  });

  it('anonymize: admins only, clears the data, idempotent, gone from the list', async () => {
    const customer = fakeCustomer({
      name: 'Paolo Neri',
      phone: '+393331234521',
      email: 'paolo.neri@example.com',
      notes: 'Note',
    });
    const operatorFake = createFakeCustomerService({ customers: [customer], role: 'operator' });
    await expect(operatorFake.service.anonymize(customer.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });

    const fake = createFakeCustomerService({ customers: [customer] });
    const { service } = fake;
    await expect(service.list({ query: '', after: null }).then(names)).resolves.toEqual([
      'Paolo Neri',
    ]);
    const erased = await service.anonymize(customer.id);
    expect(erased).toMatchObject({ phone: null, email: null, notes: null });
    expect(erased.name).toBe(`Cliente cancellato ${customer.id.slice(0, 8)}`);
    expect(erased.anonymizedAt).not.toBeNull();
    await expect(service.anonymize(customer.id)).resolves.toEqual(erased);
    await expect(service.list({ query: '', after: null }).then(names)).resolves.toEqual([]);
    await expect(service.get(customer.id)).resolves.toEqual(erased);
  });

  it('stores the email normalized, returns it everywhere and finds the customer by it', async () => {
    const { service } = createFakeCustomerService();
    const created = await service.create(newCustomer({ email: '\u00a0 Maria.Rossi@Example.COM ' }));

    expect(created.email).toBe('maria.rossi@example.com');
    await expect(service.get(created.id)).resolves.toMatchObject({
      email: 'maria.rossi@example.com',
    });
    await expect(service.list({ query: 'rossi@exa', after: null }).then(names)).resolves.toEqual([
      'Maria Rossi',
    ]);
    const without = await service.create(
      newCustomer({ operationId: OP_2, name: 'Luca Bianchi', email: '   ' }),
    );
    expect(without.email).toBeNull();
  });

  it('refuses an invalid email after every other check, like the server', async () => {
    const existing = fakeCustomer({ name: 'Anna Verdi' });
    const { service, customers } = createFakeCustomerService({ customers: [existing] });
    const kind = async (input: Partial<CreateCustomerInput>) => {
      const error = await rejection(service.create(newCustomer(input)));
      return error instanceof CustomerError ? error.kind : error;
    };

    const invalid = ['maria', 'a@b.c', 'maria@rossi', 'ma ria@example.com', 'a@@example.com'];
    await expect(Promise.all(invalid.map((email) => kind({ email })))).resolves.toEqual(
      invalid.map(() => 'email_invalid'),
    );
    expect(await kind({ email: `${'m'.repeat(243)}@example.com` })).toBe('email_invalid');
    expect(await kind({ email: 'maria', privacyConsent: false })).toBe('consent_required');
    expect(await kind({ email: 'maria', name: 'anna verdi' })).toBe('customer_name_taken');
    expect(customers()).toHaveLength(1);
    await expect(
      service.update({ id: existing.id, name: 'Anna Verdi', phone: '', email: 'x@y', notes: '' }),
    ).rejects.toMatchObject({ kind: 'email_invalid', existingCustomerId: null });
  });

  it('refuses an email already used with the id of the other customer, case aside', async () => {
    const maria = fakeCustomer({ name: 'Maria Rossi', email: 'maria.rossi@example.com' });
    const anna = fakeCustomer({ name: 'Anna Verdi', email: null });
    const { service, customers } = createFakeCustomerService({ customers: [maria, anna] });

    const error = await rejection(
      service.create(newCustomer({ name: 'Luca Bianchi', email: 'MARIA.ROSSI@example.com' })),
    );
    expect(error).toBeInstanceOf(CustomerError);
    expect(error).toMatchObject({ kind: 'customer_email_taken', existingCustomerId: maria.id });
    expect(customers()).toHaveLength(2);
    await expect(
      service.update({
        id: anna.id,
        name: 'Anna Verdi',
        phone: '',
        email: ' maria.rossi@example.com',
        notes: '',
      }),
    ).rejects.toMatchObject({ kind: 'customer_email_taken', existingCustomerId: maria.id });
    // A name and an email both taken: only the name is reported (first check).
    await expect(
      service.create(newCustomer({ name: 'anna verdi', email: 'maria.rossi@example.com' })),
    ).rejects.toMatchObject({ kind: 'customer_name_taken', existingCustomerId: anna.id });
    // The customer's own email is not a conflict; a blank email removes it.
    await expect(
      service.update({
        id: maria.id,
        name: 'Maria Rossi',
        phone: '',
        email: 'Maria.Rossi@example.com',
        notes: '',
      }),
    ).resolves.toMatchObject({ email: 'maria.rossi@example.com' });
    await expect(
      service.update({ id: maria.id, name: 'Maria Rossi', phone: '', email: ' ', notes: '' }),
    ).resolves.toMatchObject({ email: null });
    await expect(
      service.update({
        id: anna.id,
        name: 'Anna Verdi',
        phone: '',
        email: 'maria.rossi@example.com',
        notes: '',
      }),
    ).resolves.toMatchObject({ email: 'maria.rossi@example.com' });
  });

  it('anonymize clears the email and frees it for another customer', async () => {
    const maria = fakeCustomer({ name: 'Maria Rossi', email: 'maria.rossi@example.com' });
    const { service } = createFakeCustomerService({ customers: [maria] });

    await expect(service.anonymize(maria.id)).resolves.toMatchObject({ email: null });
    await expect(service.get(maria.id)).resolves.toMatchObject({ email: null });
    await expect(
      service.create(newCustomer({ name: 'Luca Bianchi', email: 'maria.rossi@example.com' })),
    ).resolves.toMatchObject({ email: 'maria.rossi@example.com' });
  });

  it('network down: every call rejects with network and changes nothing', async () => {
    const fake = createFakeCustomerService();
    fake.setNetworkDown(true);

    const error = await rejection(fake.service.create(newCustomer()));
    expect(error).toBeInstanceOf(CustomerError);
    expect(error).toMatchObject({ kind: 'network' });
    await expect(fake.service.list({ query: 'rossi', after: null })).rejects.toMatchObject({
      kind: 'network',
    });
    expect(fake.customers()).toEqual([]);

    fake.setNetworkDown(false);
    await expect(fake.service.create(newCustomer())).resolves.toMatchObject({
      name: 'Maria Rossi',
    });
  });

  it('a lost answer applies the call, then rejects with network; the resend gets the same customer', async () => {
    const fake = createFakeCustomerService();
    fake.failNext('create', 'lost');

    await expect(fake.service.create(newCustomer())).rejects.toMatchObject({ kind: 'network' });
    expect(fake.customers()).toHaveLength(1);
    const resent = await fake.service.create(newCustomer());
    expect(resent.id).toBe(fake.customers()[0]?.id);
    expect(fake.customers()).toHaveLength(1);
  });

  it('plays programmed failures once, in order, for the given method only', async () => {
    const fake = createFakeCustomerService();
    const list = () => fake.service.list({ query: 'rossi', after: null });
    fake.failNext('list', 'not_operator');
    fake.failNext('list', new ServerFaultError('unavailable'));

    await expect(fake.service.get(OP_1)).resolves.toBeNull();
    await expect(list()).rejects.toMatchObject({ kind: 'not_operator' });
    const fault = await rejection(list());
    expect(fault).toBeInstanceOf(ServerFaultError);
    await expect(list()).resolves.toEqual({ customers: [], hasMore: false });
  });

  it('holds an answer until released, so tests can settle calls out of order', async () => {
    const maria = fakeCustomer({ name: 'Maria Rossi' });
    const fake = createFakeCustomerService({ customers: [maria] });
    const gate = fake.holdNext('list');

    const settled: string[] = [];
    const slow = fake.service.list({ query: 'ma', after: null }).then(() => settled.push('slow'));
    const fast = fake.service
      .list({ query: 'maria', after: null })
      .then(() => settled.push('fast'));
    await fast;
    expect(settled).toEqual(['fast']);

    gate.release();
    await slow;
    expect(settled).toEqual(['fast', 'slow']);
  });

  it('logs every call with its arguments, in order', async () => {
    const fake = createFakeCustomerService();
    await fake.service.list({ query: 'rossi', after: null });
    await fake.service.get(OP_1);
    await fake.service.create(newCustomer()).catch(() => undefined);

    expect(fake.calls.map((call) => call.method)).toEqual(['list', 'get', 'create']);
    expect(fake.calls[0]?.args).toEqual([{ query: 'rossi', after: null }]);
    expect(fake.service.list).toHaveBeenCalledWith({ query: 'rossi', after: null });
  });

  it('returns copies, so a caller cannot change the stored customers', async () => {
    const customer = fakeCustomer({ name: 'Anna Verdi' });
    const { service } = createFakeCustomerService({ customers: [customer] });
    const found = await service.get(customer.id);
    if (found) found.name = 'Cambiato';
    await expect(service.get(customer.id)).resolves.toMatchObject({ name: 'Anna Verdi' });
  });
});

function names(page: { customers: { name: string }[] }): string[] {
  return page.customers.map((c) => c.name);
}

describe('createFakeCustomerService: list', () => {
  it('orders like list_customers: latest activity, then latest creation, then id; never anonymized', async () => {
    const quiet = fakeCustomer({ name: 'Senza Movimenti', createdAt: '2026-11-20T09:00:00+00:00' });
    const older = fakeCustomer({ name: 'Creato Prima', createdAt: '2026-11-02T09:00:00+00:00' });
    const served = fakeCustomer({
      name: 'Servito Ieri',
      createdAt: '2026-10-01T09:00:00+00:00',
      lastActivityAt: '2026-11-22T18:40:00.000001+00:00',
    });
    const today = fakeCustomer({
      name: 'Servito Oggi',
      createdAt: '2026-10-01T09:00:00+00:00',
      lastActivityAt: '2026-11-23T10:15:00+00:00',
    });
    const twinA = fakeCustomer({
      id: '00000000-0000-4000-8000-00000000000a',
      name: 'Gemello A',
      createdAt: '2026-11-10T09:00:00.123456+00:00',
    });
    const twinB = fakeCustomer({
      id: '00000000-0000-4000-8000-00000000000b',
      name: 'Gemello B',
      createdAt: '2026-11-10T09:00:00.123456+00:00',
    });
    const erased = fakeCustomer({
      name: 'Cliente cancellato 00000000',
      anonymizedAt: '2026-11-17T09:00:00Z',
      lastActivityAt: '2026-11-23T11:00:00+00:00',
    });
    const { service } = createFakeCustomerService({
      customers: [older, quiet, served, erased, twinA, today, twinB],
    });

    const page = await service.list({ query: '', after: null });
    expect(names(page)).toEqual([
      'Servito Oggi',
      'Servito Ieri',
      'Senza Movimenti',
      'Gemello B',
      'Gemello A',
      'Creato Prima',
    ]);
    expect(page.hasMore).toBe(false);
    expect(page.customers[1]).toEqual({
      id: served.id,
      name: 'Servito Ieri',
      balance: 0,
      lastActivityAt: '2026-11-22T18:40:00.000001+00:00',
      createdAt: '2026-10-01T09:00:00+00:00',
    });
  });

  it('gives fixtures and created customers a creation time, newest last, with microseconds', async () => {
    const first = fakeCustomer({ name: 'Primo' });
    const { service } = createFakeCustomerService({ customers: [first] });
    await service.create(newCustomer({ name: 'Secondo' }));
    const page = await service.list({ query: '', after: null });
    expect(names(page)).toEqual(['Secondo', 'Primo']);
    for (const row of page.customers) {
      expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/);
      expect(row.lastActivityAt).toBeNull();
    }
  });

  it('filters by every word of the name or by part of the email, from 2 characters', async () => {
    const maria = fakeCustomer({ name: 'Maria Rossi', email: 'mrossi@example.com' });
    const nicola = fakeCustomer({ name: 'Nicolò D’Angelo', email: null });
    const percent = fakeCustomer({ name: 'Anna Verdi', email: 'anna_50%@example.com' });
    const plain = fakeCustomer({ name: 'Anna Bianchi', email: 'annax50y@example.com' });
    const { service } = createFakeCustomerService({
      customers: [maria, nicola, percent, plain],
    });
    const found = async (query: string) => names(await service.list({ query, after: null }));

    await expect(found('rossi maria')).resolves.toEqual(['Maria Rossi']);
    await expect(found('  ROSSI   ma ')).resolves.toEqual(['Maria Rossi']);
    await expect(found("nicolo d'ang")).resolves.toEqual(['Nicolò D’Angelo']);
    await expect(found('MROSSI@exa')).resolves.toEqual(['Maria Rossi']);
    await expect(found('example.com')).resolves.toEqual([
      'Anna Bianchi',
      'Anna Verdi',
      'Maria Rossi',
    ]);
    await expect(found('_50%')).resolves.toEqual(['Anna Verdi']);
    await expect(found('rossi verdi')).resolves.toEqual([]);
    await expect(found('r')).resolves.toHaveLength(4);
    await expect(found(' ')).resolves.toHaveLength(4);
  });

  it('pages of 20 through the cursor of the last row, without duplicates or gaps', async () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      fakeCustomer({
        name: `Cliente ${String(index).padStart(2, '0')}`,
        // Groups of three created in the same microsecond: the id breaks the tie.
        createdAt: `2026-11-01T08:00:${String(Math.floor(index / 3)).padStart(2, '0')}.000001+00:00`,
        lastActivityAt:
          index % 4 === 0 ? `2026-11-20T08:00:00.${String(index).padStart(6, '0')}+00:00` : null,
      }),
    );
    const { service } = createFakeCustomerService({ customers: many });

    const seen: string[] = [];
    let after = null;
    const sizes: number[] = [];
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- each page needs the cursor of the one before it.
      const page: Awaited<ReturnType<typeof service.list>> = await service.list({
        query: 'cliente',
        after,
      });
      sizes.push(page.customers.length);
      seen.push(...page.customers.map((c) => c.id));
      const last = page.customers.at(-1);
      if (!page.hasMore || !last) break;
      after = { activityAt: last.lastActivityAt, createdAt: last.createdAt, id: last.id };
    }
    expect(sizes).toEqual([20, 20, 5]);
    expect(new Set(seen).size).toBe(45);
    const all = await service.list({ query: '', after: null });
    expect(seen.slice(0, 20)).toEqual(all.customers.map((c) => c.id));
  });

  it('a page that ends exactly on the last customer is followed by an empty one', async () => {
    const twenty = Array.from({ length: 20 }, (_, index) => fakeCustomer({ name: `C ${index}` }));
    const { service } = createFakeCustomerService({ customers: twenty });
    const first = await service.list({ query: '', after: null });
    expect(first.hasMore).toBe(true);
    const last = first.customers.at(-1);
    if (!last) throw new Error('expected a row');
    const second = await service.list({
      query: '',
      after: { activityAt: last.lastActivityAt, createdAt: last.createdAt, id: last.id },
    });
    expect(second).toEqual({ customers: [], hasMore: false });
  });

  it('is logged and programmable like every other method', async () => {
    const fake = createFakeCustomerService();
    fake.failNext('list', 'not_operator');
    await expect(fake.service.list({ query: '', after: null })).rejects.toMatchObject({
      kind: 'not_operator',
    });
    expect(fake.calls).toEqual([{ method: 'list', args: [{ query: '', after: null }] }]);
  });
});
