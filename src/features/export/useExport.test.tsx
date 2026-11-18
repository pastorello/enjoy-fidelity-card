import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import {
  createFakeExportService,
  fakeCustomerExportRow,
  fakeMovementExportRow,
} from '../../test/fakeExportService';
import { buildCustomersCsv } from './buildCustomersCsv';
import { buildMovementsCsv } from './buildMovementsCsv';
import { ExportServiceProvider } from './ExportServiceProvider';
import type { DownloadFile } from './downloadFile';
import type { ExportKind, ExportResult } from './types';
import { useExport } from './useExport';

type Fake = ReturnType<typeof createFakeExportService>;

function renderUseExport(kind: ExportKind, fake: Fake, download: DownloadFile = fake.download) {
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <ExportServiceProvider service={fake.service} download={download}>
        {children}
      </ExportServiceProvider>
    );
  }
  return renderHook(() => useExport(kind), { wrapper });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useExport', () => {
  it('reads every page, builds the CSV and saves it, returning the row count', async () => {
    const fake = createFakeExportService({ pageLimit: 1 });
    const { result } = renderUseExport('movements', fake);
    expect(result.current.busy).toBe(false);

    let outcome: ExportResult | undefined;
    await act(async () => {
      outcome = await result.current.run();
    });

    expect(outcome).toEqual({ status: 'ok', count: 3 });
    expect(fake.pages.filter((p) => p.method === 'fetchMovements')).toHaveLength(4);
    expect(fake.downloads).toHaveLength(1);
    expect(fake.downloads[0]?.content).toBe(buildMovementsCsv(fake.movements()));
    expect(result.current.busy).toBe(false);
  });

  it('exports the customers file from fetchCustomers', async () => {
    const fake = createFakeExportService();
    const { result } = renderUseExport('customers', fake);
    let outcome: ExportResult | undefined;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ status: 'ok', count: 2 });
    expect(fake.calls).toEqual([{ method: 'fetchCustomers' }]);
    expect(fake.downloads[0]?.content).toBe(buildCustomersCsv(fake.customers()));
    expect(fake.downloads[0]?.fileName).toMatch(/^enjoy-clienti-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('with no rows still saves the header-only file and counts 0', async () => {
    const fake = createFakeExportService({ customers: [], movements: [] });
    const { result } = renderUseExport('movements', fake);
    let outcome: ExportResult | undefined;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ status: 'ok', count: 0 });
    expect(fake.downloads[0]?.content).toBe(buildMovementsCsv([]));
  });

  it('two run() in a row make one service call; busy while it runs, false after', async () => {
    const fake = createFakeExportService();
    const hold = fake.holdNext('fetchCustomers');
    const { result } = renderUseExport('customers', fake);

    let first: Promise<ExportResult> | undefined;
    let second: Promise<ExportResult> | undefined;
    act(() => {
      first = result.current.run();
      second = result.current.run();
    });
    expect(fake.service.fetchCustomers).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);

    // A third call after the re-render, still while busy: ignored too.
    let third: Promise<ExportResult> | undefined;
    act(() => {
      third = result.current.run();
    });
    expect(fake.service.fetchCustomers).toHaveBeenCalledTimes(1);

    await act(async () => {
      hold.release();
      await first;
    });
    expect(result.current.busy).toBe(false);
    // The ignored calls answer with the outcome of the run in progress, with no second file.
    await expect(second).resolves.toEqual({ status: 'ok', count: 2 });
    await expect(third).resolves.toEqual({ status: 'ok', count: 2 });
    expect(fake.downloads).toHaveLength(1);
  });

  it('a network error on the second page saves nothing; a new run() succeeds (criterion 7)', async () => {
    const movements = Array.from({ length: 3 }, (_, i) =>
      fakeMovementExportRow({ createdAt: `2026-11-17T18:1${i}:00.000000+00:00` }),
    );
    const fake = createFakeExportService({ customers: [], movements, pageLimit: 2 });
    fake.failPage('fetchMovements', 2, 'network');
    const { result } = renderUseExport('movements', fake);

    let outcome: ExportResult | undefined;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ status: 'network' });
    expect(fake.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(fake.download).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);

    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ status: 'ok', count: 3 });
    expect(fake.service.fetchMovements).toHaveBeenCalledTimes(2);
    expect(fake.downloads).toHaveLength(1);
    expect(fake.downloads[0]?.content).toBe(buildMovementsCsv(movements));
  });

  it('an operator gets forbidden and no file', async () => {
    const fake = createFakeExportService({ role: 'operator' });
    const { result } = renderUseExport('customers', fake);
    let outcome: ExportResult | undefined;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ status: 'forbidden' });
    expect(fake.download).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', 'unknown' as const],
    ['a server fault', new ServerFaultError('misconfigured')],
    ['an unexpected error', new Error('boom')],
  ])('%s → unknown, no file', async (_label, failure) => {
    const fake = createFakeExportService();
    fake.failPage('fetchCustomers', 1, failure);
    const { result } = renderUseExport('customers', fake);
    let outcome: ExportResult | undefined;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ status: 'unknown' });
    expect(fake.download).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it('a row the CSV cannot be built from → unknown, no file', async () => {
    const fake = createFakeExportService({
      customers: [fakeCustomerExportRow({ createdAt: 'not a date' })],
      movements: [],
    });
    const { result } = renderUseExport('customers', fake);
    let outcome: ExportResult | undefined;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ status: 'unknown' });
    expect(fake.download).not.toHaveBeenCalled();
  });

  it('a download that throws → unknown, and busy ends', async () => {
    const fake = createFakeExportService();
    const download = vi.fn<DownloadFile>(() => {
      throw new Error('blocked');
    });
    const { result } = renderUseExport('customers', fake, download);
    let outcome: ExportResult | undefined;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ status: 'unknown' });
    expect(download).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it("names the file with Rome's day, not the device's (criterion 8)", async () => {
    // 23:30 UTC on 17 November is already 18 November in Rome.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T23:30:00Z'));
    const fake = createFakeExportService();
    const { result } = renderUseExport('movements', fake);
    await act(async () => {
      await result.current.run();
    });
    expect(fake.downloads.map((d) => d.fileName)).toEqual(['enjoy-movimenti-2026-11-18.csv']);
  });

  it('the CSV starts with the BOM, so Excel reads it as UTF-8', async () => {
    const fake = createFakeExportService();
    const { result } = renderUseExport('customers', fake);
    await act(async () => {
      await result.current.run();
    });
    expect(fake.downloads[0]?.content.startsWith('﻿')).toBe(true);
  });
});
