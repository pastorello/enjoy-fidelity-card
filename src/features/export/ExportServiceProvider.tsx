import { createContext, use, useMemo } from 'react';
import type { ReactNode } from 'react';
import { downloadFile } from './downloadFile';
import type { DownloadFile } from './downloadFile';
import type { ExportService } from './types';

type ExportContext = { service: ExportService; download: DownloadFile };

const ExportServiceContext = createContext<ExportContext | null>(null);

/**
 * Supplies the ExportService and the function that saves a file, like LedgerServiceProvider:
 * `main.tsx` passes the Supabase service and the real `downloadFile`, `renderApp` the fake and its
 * download spy, so component tests read the file instead of saving it.
 */
export function ExportServiceProvider({
  service,
  download = downloadFile,
  children,
}: {
  service: ExportService;
  download?: DownloadFile;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ service, download }), [service, download]);
  return <ExportServiceContext value={value}>{children}</ExportServiceContext>;
}

function useExportContext(hook: string): ExportContext {
  const context = use(ExportServiceContext);
  if (!context) throw new Error(`${hook} must be used inside <ExportServiceProvider>`);
  return context;
}

export function useExportService(): ExportService {
  return useExportContext('useExportService').service;
}

export function useExportDownload(): DownloadFile {
  return useExportContext('useExportDownload').download;
}
