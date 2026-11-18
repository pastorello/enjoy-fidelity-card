import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../lib/serverFault';
import { ExportError } from '../features/export/types';
import type { ExportErrorKind } from '../features/export/types';
import {
  createFakeExportService,
  fakeCustomerExportRow,
  fakeMovementExportRow,
} from './fakeExportService';

async function errorKind(promise: Promise<unknown>): Promise<ExportErrorKind> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (rejected: unknown) => rejected,
  );
  if (!(error instanceof ExportError)) throw error;
  return error.kind;
}

describe('fakeCustomerExportRow / fakeMovementExportRow', () => {
  it('build rows with fake data only and fresh UUID-shaped ids', () => {
    const a = fakeCustomerExportRow();
    const b = fakeCustomerExportRow({ name: 'Elia Prova' });
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(b.name).toBe('Elia Prova');
    const movement = fakeMovementExportRow();
    expect(movement).toMatchObject({ kind: 'purchase', amountCents: 1250, points: 12 });
  });
});

describe('createFakeExportService', () => {
  it('answers an admin with every row, customers by id and movements by (createdAt, id)', async () => {
    const second = fakeCustomerExportRow({ id: '00000000-0000-4000-8000-000000000002' });
    const first = fakeCustomerExportRow({ id: '00000000-0000-4000-8000-000000000001' });
    const late = fakeMovementExportRow({
      id: '00000000-0000-4000-d000-000000000001',
      createdAt: '2026-11-17T18:00:00.000002+00:00',
    });
    const earlyB = fakeMovementExportRow({
      id: '00000000-0000-4000-d000-000000000003',
      createdAt: '2026-11-17T18:00:00.000001+00:00',
    });
    const earlyA = fakeMovementExportRow({
      id: '00000000-0000-4000-d000-000000000002',
      createdAt: '2026-11-17T18:00:00.000001+00:00',
    });
    const fake = createFakeExportService({
      customers: [second, first],
      movements: [late, earlyB, earlyA],
    });
    expect(await fake.service.fetchCustomers()).toEqual([first, second]);
    expect(await fake.service.fetchMovements()).toEqual([earlyA, earlyB, late]);
  });

  it('starts with rows of its own, so a test has something to export', async () => {
    const fake = createFakeExportService();
    expect((await fake.service.fetchCustomers()).length).toBeGreaterThan(0);
    expect((await fake.service.fetchMovements()).length).toBeGreaterThan(0);
  });

  it('returns copies: a caller cannot change the rows it keeps', async () => {
    const fake = createFakeExportService({ customers: [fakeCustomerExportRow({ name: 'Ada' })] });
    const [row] = await fake.service.fetchCustomers();
    if (!row) throw new Error('expected a row');
    row.name = 'changed';
    expect((await fake.service.fetchCustomers())[0]?.name).toBe('Ada');
  });

  it('refuses an operator and a user without a profile with forbidden, like the server', async () => {
    const operator = createFakeExportService({ role: 'operator' });
    expect(await errorKind(operator.service.fetchCustomers())).toBe('forbidden');
    expect(await errorKind(operator.service.fetchMovements())).toBe('forbidden');
    const none = createFakeExportService({ role: null });
    expect(await errorKind(none.service.fetchCustomers())).toBe('forbidden');
  });

  it('follows a role changed on the server while the page is open', async () => {
    const fake = createFakeExportService();
    await fake.service.fetchCustomers();
    fake.setRole('operator');
    expect(await errorKind(fake.service.fetchCustomers())).toBe('forbidden');
    fake.setRole('admin');
    await expect(fake.service.fetchCustomers()).resolves.toHaveLength(fake.customers().length);
  });

  it('reads in pages of pageLimit rows, with the cursor of the last row', async () => {
    const rows = [1, 2, 3, 4, 5].map((n) =>
      fakeMovementExportRow({
        id: `00000000-0000-4000-d000-00000000000${n}`,
        createdAt: `2026-11-17T18:00:0${n}.000001+00:00`,
      }),
    );
    const fake = createFakeExportService({ movements: rows, pageLimit: 2 });
    expect(await fake.service.fetchMovements()).toEqual(rows);
    expect(fake.pages.map(({ page, cursor, limit }) => ({ page, cursor, limit }))).toEqual([
      { page: 1, cursor: null, limit: 2 },
      { page: 2, cursor: { createdAt: rows[1]?.createdAt, id: rows[1]?.id }, limit: 2 },
      { page: 3, cursor: { createdAt: rows[3]?.createdAt, id: rows[3]?.id }, limit: 2 },
    ]);
  });

  it('rejects with network when the network is down on the first or the second page', async () => {
    const customers = [1, 2, 3].map(() => fakeCustomerExportRow());
    const fake = createFakeExportService({ customers, pageLimit: 2 });
    fake.failPage('fetchCustomers', 1, 'network');
    expect(await errorKind(fake.service.fetchCustomers())).toBe('network');
    fake.failPage('fetchCustomers', 2, 'network');
    expect(await errorKind(fake.service.fetchCustomers())).toBe('network');
    // Each programmed failure is used once: the next run reads everything.
    await expect(fake.service.fetchCustomers()).resolves.toHaveLength(3);
    expect(fake.pages.map(({ page }) => page)).toEqual([1, 1, 2, 1, 2]);
  });

  it('rejects with the programmed error or kind, server faults included', async () => {
    const fake = createFakeExportService();
    fake.failPage('fetchMovements', 1, 'unknown');
    expect(await errorKind(fake.service.fetchMovements())).toBe('unknown');
    const fault = new ServerFaultError('misconfigured');
    fake.failPage('fetchMovements', 1, fault);
    await expect(fake.service.fetchMovements()).rejects.toBe(fault);
  });

  it('rejects every call with network while the network is down', async () => {
    const fake = createFakeExportService();
    fake.setNetworkDown(true);
    expect(await errorKind(fake.service.fetchCustomers())).toBe('network');
    expect(await errorKind(fake.service.fetchMovements())).toBe('network');
    fake.setNetworkDown(false);
    await expect(fake.service.fetchMovements()).resolves.toHaveLength(fake.movements().length);
  });

  it('holds the next call until released', async () => {
    const fake = createFakeExportService();
    const { release } = fake.holdNext('fetchCustomers');
    let settled = false;
    const pending = fake.service.fetchCustomers().then((rows) => {
      settled = true;
      return rows;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await expect(pending).resolves.toHaveLength(fake.customers().length);
  });

  it('logs every call and every page, and spies on each method', async () => {
    const fake = createFakeExportService();
    await fake.service.fetchCustomers();
    await fake.service.fetchMovements();
    expect(fake.calls).toEqual([{ method: 'fetchCustomers' }, { method: 'fetchMovements' }]);
    expect(fake.pages.map(({ method }) => method)).toEqual(['fetchCustomers', 'fetchMovements']);
    expect(fake.service.fetchCustomers).toHaveBeenCalledTimes(1);
  });

  it('keeps the files handed to its download spy', () => {
    const fake = createFakeExportService();
    fake.download('enjoy-clienti-2026-11-18.csv', 'Nome\r\n');
    expect(fake.download).toHaveBeenCalledTimes(1);
    expect(fake.downloads).toEqual([
      { fileName: 'enjoy-clienti-2026-11-18.csv', content: 'Nome\r\n' },
    ]);
  });
});
