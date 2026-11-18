import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeExportService } from '../../test/fakeExportService';
import { downloadFile } from './downloadFile';
import {
  ExportServiceProvider,
  useExportDownload,
  useExportService,
} from './ExportServiceProvider';
import type { DownloadFile } from './downloadFile';

function DefaultDownloadProbe() {
  return <p>{useExportDownload() === downloadFile ? 'default' : 'other'}</p>;
}

function ServiceProbe() {
  useExportService();
  return null;
}

function DownloadProbe() {
  useExportDownload();
  return null;
}

describe('ExportServiceProvider', () => {
  it('gives its service and its download function to the hooks', () => {
    const { service } = createFakeExportService();
    const download = vi.fn<DownloadFile>();
    function Probe() {
      const injected = useExportService();
      const save = useExportDownload();
      return (
        <p>
          {injected === service ? 'same service' : 'other service'},{' '}
          {save === download ? 'same download' : 'other download'}
        </p>
      );
    }
    render(
      <ExportServiceProvider service={service} download={download}>
        <Probe />
      </ExportServiceProvider>,
    );
    expect(screen.getByText('same service, same download')).toBeInTheDocument();
  });

  it('downloads with downloadFile when no download function is given', () => {
    const { service } = createFakeExportService();
    render(
      <ExportServiceProvider service={service}>
        <DefaultDownloadProbe />
      </ExportServiceProvider>,
    );
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('useExportService outside the provider throws a clear error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<ServiceProbe />)).toThrow(
      'useExportService must be used inside <ExportServiceProvider>',
    );
    vi.restoreAllMocks();
  });

  it('useExportDownload outside the provider throws a clear error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<DownloadProbe />)).toThrow(
      'useExportDownload must be used inside <ExportServiceProvider>',
    );
    vi.restoreAllMocks();
  });
});
