// The whole path of one export (SPEC-export, points 2 and 3): read every page, build the CSV, save the
// file. Nothing is saved unless every page arrived and the text was built, so there is never a partial
// file. The export only reads, so retrying is safe and needs no operation id.

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildCustomersCsv } from './buildCustomersCsv';
import { buildMovementsCsv } from './buildMovementsCsv';
import { useExportDownload, useExportService } from './ExportServiceProvider';
import { exportFileName } from './formatExport';
import { ExportError } from './types';
import type { ExportKind, ExportResult, ExportService } from './types';

/** Reads the rows of `kind` and turns them into the file's text, with the row count. */
async function buildFile(
  service: ExportService,
  kind: ExportKind,
): Promise<{ content: string; count: number }> {
  if (kind === 'customers') {
    const rows = await service.fetchCustomers();
    return { content: buildCustomersCsv(rows), count: rows.length };
  }
  const rows = await service.fetchMovements();
  return { content: buildMovementsCsv(rows), count: rows.length };
}

/**
 * `forbidden` and `network` as the service says; anything else (the service's `unknown`, a server
 * fault, a row the CSV cannot be built from, a download that throws) is `unknown`.
 */
function failureOf(error: unknown): ExportResult {
  if (error instanceof ExportError && error.kind !== 'unknown') return { status: error.kind };
  return { status: 'unknown' };
}

export function useExport(kind: ExportKind): { run(): Promise<ExportResult>; busy: boolean } {
  const service = useExportService();
  const download = useExportDownload();
  const [busy, setBusy] = useState(false);
  // The run in progress, set synchronously: two taps in the same tick start a single export, and a
  // call while busy answers with that run's outcome instead of starting another.
  const inFlight = useRef<Promise<ExportResult> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback((): Promise<ExportResult> => {
    if (inFlight.current) return inFlight.current;
    const attempt = (async (): Promise<ExportResult> => {
      try {
        const { content, count } = await buildFile(service, kind);
        // The day in the name is taken when the file is saved, on Rome's clock.
        download(exportFileName(kind, new Date()), content);
        return { status: 'ok', count };
      } catch (error) {
        return failureOf(error);
      }
    })();
    inFlight.current = attempt;
    setBusy(true);
    void attempt.finally(() => {
      inFlight.current = null;
      if (mounted.current) setBusy(false);
    });
    return attempt;
  }, [service, download, kind]);

  return { run, busy };
}
