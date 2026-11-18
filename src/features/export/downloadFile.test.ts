import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOM } from './csv';
import { REVOKE_DELAY_MS, downloadFile } from './downloadFile';

// jsdom has no URL.createObjectURL: the test supplies both URL functions and watches the link.

let created: Blob[];
let revoked: string[];
let clicked: { download: string; href: string; attached: boolean }[];

beforeEach(() => {
  vi.useFakeTimers();
  created = [];
  revoked = [];
  clicked = [];
  Object.assign(URL, {
    createObjectURL: vi.fn<(blob: Blob) => string>((blob) => {
      created.push(blob);
      return 'blob:fake-export-url';
    }),
    revokeObjectURL: vi.fn<(url: string) => void>((url) => {
      revoked.push(url);
    }),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
    this: HTMLAnchorElement,
  ) {
    clicked.push({
      download: this.getAttribute('download') ?? '',
      href: this.getAttribute('href') ?? '',
      attached: document.body.contains(this),
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('downloadFile', () => {
  it('saves the text as a UTF-8 CSV Blob through a link with the download attribute', async () => {
    downloadFile('enjoy-clienti-2026-11-18.csv', `${BOM}Nome;Saldo punti\r\n`);
    expect(created).toHaveLength(1);
    const blob = created[0];
    expect(blob?.type).toBe('text/csv;charset=utf-8');
    // The BOM stays in the bytes: Excel needs it to read the file as UTF-8.
    if (!blob) throw new Error('expected a Blob');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(clicked).toEqual([
      { download: 'enjoy-clienti-2026-11-18.csv', href: 'blob:fake-export-url', attached: true },
    ]);
  });

  it('revokes the URL after the click, not in the same instant', () => {
    downloadFile('enjoy-movimenti-2026-11-18.csv', 'x');
    expect(clicked).toHaveLength(1);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(revoked).toEqual(['blob:fake-export-url']);
  });

  it('leaves no link in the page', () => {
    downloadFile('enjoy-clienti-2026-11-18.csv', 'x');
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});
