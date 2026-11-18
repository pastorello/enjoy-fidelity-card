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
  it('creates a customer that get and search then find, normalizing name and phone', async () => {
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
    await expect(service.search('rossi maria')).resolves.toEqual([created]);
    await expect(service.search('4521')).resolves.toEqual([created]);
  });

  it('refuses an equivalent name (case, accents, apostrophes, spaces) with the existing id', async () => {
    const existing = fakeCustomer({ name: "Nicolò D'Angelo" });
    const { service } = createFakeCustomerService({ customers: [existing] });

    const error = await rejection(service.create(newCustomer({ name: 'nicolo   D’ANGELO' })));
    expect(error).toBeInstanceOf(CustomerError);
    expect(error).toMatchObject({ kind: 'customer_name_taken', existingCustomerId: existing.id });

    const other = await service.create(newCustomer({ operationId: OP_2, name: 'Luca Bianchi' }));
    await expect(
      service.update({ id: other.id, name: 'NICOLO d’angelo', phone: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_name_taken', existingCustomerId: existing.id });
    // Renaming a customer to another spelling of its own name is fine.
    await expect(
      service.update({ id: existing.id, name: 'Nicolo D’Angelo', phone: '', notes: '' }),
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
      service.update({ id: kept.id, name: 'Anna Verdi', phone: ' ', notes: '' }),
    ).resolves.toMatchObject({ phone: null, notes: null });
    await expect(
      service.update({ id: erased.id, name: 'Nuovo', phone: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_anonymized' });
    await expect(
      service.update({ id: OP_2, name: 'Nuovo', phone: '', notes: '' }),
    ).rejects.toMatchObject({ kind: 'customer_not_found' });
    await expect(service.get(OP_2)).resolves.toBeNull();
  });

  it('search: by name words or phone digits, alphabetical, 21 rows at most, never anonymized', async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      fakeCustomer({ name: `Rossi ${String(25 - index).padStart(2, '0')}` }),
    );
    const erased = fakeCustomer({ name: 'Rossi Cancellato', anonymizedAt: '2026-11-17T09:00:00Z' });
    const phoned = fakeCustomer({ name: 'Zeta', phone: '+393331234521' });
    const { service } = createFakeCustomerService({ customers: [...many, erased, phoned] });

    const rows = await service.search('rossi');
    expect(rows).toHaveLength(21);
    expect(rows[0]?.name).toBe('Rossi 01');
    expect(rows.map((row) => row.name)).not.toContain('Rossi Cancellato');
    await expect(service.search('0039 333')).resolves.toEqual([phoned]);
    await expect(service.search('45')).resolves.toEqual([]);
    await expect(service.search('r')).resolves.toEqual([]);
    await expect(service.search('50%')).resolves.toEqual([]);
  });

  it('anonymize: admins only, clears the data, idempotent, gone from search and served today', async () => {
    const customer = fakeCustomer({ name: 'Paolo Neri', phone: '+393331234521', notes: 'Note' });
    const operatorFake = createFakeCustomerService({ customers: [customer], role: 'operator' });
    await expect(operatorFake.service.anonymize(customer.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });

    const fake = createFakeCustomerService({ customers: [customer] });
    const { service } = fake;
    fake.setServedToday([customer.id]);
    await expect(service.servedToday()).resolves.toHaveLength(1);
    const erased = await service.anonymize(customer.id);
    expect(erased).toMatchObject({ phone: null, notes: null });
    expect(erased.name).toBe(`Cliente cancellato ${customer.id.slice(0, 8)}`);
    expect(erased.anonymizedAt).not.toBeNull();
    await expect(service.anonymize(customer.id)).resolves.toEqual(erased);
    await expect(service.search('paolo')).resolves.toEqual([]);
    await expect(service.servedToday()).resolves.toEqual([]);
    await expect(service.get(customer.id)).resolves.toEqual(erased);
  });

  it('network down: every call rejects with network and changes nothing', async () => {
    const fake = createFakeCustomerService();
    fake.setNetworkDown(true);

    const error = await rejection(fake.service.create(newCustomer()));
    expect(error).toBeInstanceOf(CustomerError);
    expect(error).toMatchObject({ kind: 'network' });
    await expect(fake.service.search('rossi')).rejects.toMatchObject({ kind: 'network' });
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
    fake.failNext('search', 'not_operator');
    fake.failNext('search', new ServerFaultError('unavailable'));

    await expect(fake.service.servedToday()).resolves.toEqual([]);
    await expect(fake.service.search('rossi')).rejects.toMatchObject({ kind: 'not_operator' });
    const fault = await rejection(fake.service.search('rossi'));
    expect(fault).toBeInstanceOf(ServerFaultError);
    await expect(fake.service.search('rossi')).resolves.toEqual([]);
  });

  it('holds an answer until released, so tests can settle calls out of order', async () => {
    const maria = fakeCustomer({ name: 'Maria Rossi' });
    const fake = createFakeCustomerService({ customers: [maria] });
    const gate = fake.holdNext('search');

    const settled: string[] = [];
    const slow = fake.service.search('ma').then(() => settled.push('slow'));
    const fast = fake.service.search('maria').then(() => settled.push('fast'));
    await fast;
    expect(settled).toEqual(['fast']);

    gate.release();
    await slow;
    expect(settled).toEqual(['fast', 'slow']);
  });

  it('logs every call with its arguments, in order', async () => {
    const fake = createFakeCustomerService();
    await fake.service.search('rossi');
    await fake.service.get(OP_1);
    await fake.service.create(newCustomer()).catch(() => undefined);

    expect(fake.calls.map((call) => call.method)).toEqual(['search', 'get', 'create']);
    expect(fake.calls[0]?.args).toEqual(['rossi']);
    expect(fake.service.search).toHaveBeenCalledWith('rossi');
  });

  it('returns copies, so a caller cannot change the stored customers', async () => {
    const customer = fakeCustomer({ name: 'Anna Verdi' });
    const { service } = createFakeCustomerService({ customers: [customer] });
    const found = await service.get(customer.id);
    if (found) found.name = 'Cambiato';
    await expect(service.get(customer.id)).resolves.toMatchObject({ name: 'Anna Verdi' });
  });
});
