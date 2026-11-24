import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeWebNfc } from '../../test/fakeWebNfc';
import { createCardReader, type CardRead } from './cardReader';
import { CardReaderProvider } from './CardReaderProvider';
import { useCardRead } from './useCardRead';
import { useCardWriter } from './useCardWriter';
import { createWebNfcAdapter } from './webNfcAdapter';
import type { CardWriteResult, CardWriteStep } from './webNfcWriter';

// SPEC-card-input, points 5 and 9; success criterion 10. Invented uids and links only.

const UID = '04A1B2C3D4E5F6';
const URL = 'https://example.test/p/invented-token';

/** Lets the pending promises (permission query, scan, write) settle. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function setup(options: { supported?: boolean; writable?: boolean } = {}) {
  const nfc = createFakeWebNfc({ permission: 'granted', ...options });
  let clock = 1_000_000;
  const reader = createCardReader({
    // Each read comes 5 s after the previous one: past the repeat window and IN_FIELD_MS.
    now: () => (clock += 5000),
    adapters: [],
    nfc: createWebNfcAdapter(nfc.api),
    writer: nfc.api,
  });
  const onRead = vi.fn<(read: CardRead) => void>();
  const steps: CardWriteStep[] = [];
  const results: CardWriteResult[] = [];
  render(
    <CardReaderProvider reader={reader}>
      <Page
        onRead={onRead}
        onStep={(step) => steps.push(step)}
        onResult={(result) => results.push(result)}
      />
    </CardReaderProvider>,
  );
  reader.activate({ usbFormat: null });
  await settle();
  return { nfc, reader, onRead, steps, results };
}

/** A fake screen that reads cards and writes the link on one, or erases it, with a tap. */
function Page({
  onRead,
  onStep,
  onResult,
}: {
  onRead: (read: CardRead) => void;
  onStep: (step: CardWriteStep) => void;
  onResult: (result: CardWriteResult) => void;
}) {
  useCardRead(onRead);
  const { canWrite, writeUrl, eraseCard } = useCardWriter();
  const [writing, setWriting] = useState(false);
  const run = (job: Promise<CardWriteResult>) => {
    setWriting(true);
    void job.then((result) => {
      setWriting(false);
      onResult(result);
    });
  };
  return (
    <>
      <p>{canWrite ? 'può scrivere' : 'non scrive'}</p>
      <button
        type="button"
        disabled={writing}
        onClick={() => {
          run(writeUrl(URL, { expectedUid: UID, onStep }));
        }}
      >
        Scrivi il link
      </button>
      <button
        type="button"
        disabled={writing}
        onClick={() => {
          run(eraseCard({ expectedUid: UID, onStep }));
        }}
      >
        Svuota la card
      </button>
    </>
  );
}

describe('useCardWriter', () => {
  it('exposes canWrite from the service state', async () => {
    await setup();
    expect(screen.getByText('può scrivere')).toBeInTheDocument();
  });

  it('has canWrite false where Web NFC is unsupported (iPhone, tablet)', async () => {
    await setup({ supported: false });
    expect(screen.getByText('non scrive')).toBeInTheDocument();
  });

  it('has canWrite false with an NDEFReader without write()', async () => {
    await setup({ writable: false });
    expect(screen.getByText('non scrive')).toBeInTheDocument();
  });

  it('reports waiting-card, writing, verifying, and keeps the reads from the page meanwhile', async () => {
    const { nfc, onRead, steps, results } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Scrivi il link' }));
    expect(steps).toEqual(['waiting-card']);

    // The card is held to the phone: it goes to the writer, not to the page.
    act(() => {
      nfc.read(UID);
    });
    expect(steps).toEqual(['waiting-card', 'writing']);
    await settle();
    expect(steps).toEqual(['waiting-card', 'writing', 'verifying']);
    expect(nfc.writes).toHaveLength(1);

    // Read back with the link: the write succeeds.
    act(() => {
      nfc.read(UID, { urls: [URL] });
    });
    await settle();
    expect(results).toEqual([{ ok: true }]);
    expect(onRead).not.toHaveBeenCalled();
    expect(nfc.makeReadOnlyCalls()).toBe(0);

    // Once the write is over, the page gets the reads again.
    act(() => {
      nfc.read(UID);
    });
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead.mock.calls[0]?.[0]).toMatchObject({ uid: UID, source: 'web-nfc' });
  });

  it('refuses with cannot-write and touches no card when canWrite is false', async () => {
    const { nfc, steps, results } = await setup({ writable: false });

    fireEvent.click(screen.getByRole('button', { name: 'Scrivi il link' }));
    await settle();

    expect(results).toEqual([{ ok: false, reason: 'cannot-write' }]);
    expect(steps).toEqual([]);
    expect(nfc.writes).toHaveLength(0);
  });

  // SPEC-customers-v2, point 4: eraseCard has the preconditions and the session of writeUrl.
  it('eraseCard refuses with cannot-write and touches no card when canWrite is false', async () => {
    const { nfc, steps, results } = await setup({ writable: false });

    fireEvent.click(screen.getByRole('button', { name: 'Svuota la card' }));
    await settle();

    expect(results).toEqual([{ ok: false, reason: 'cannot-write' }]);
    expect(steps).toEqual([]);
    expect(nfc.writes).toHaveLength(0);
  });

  it('eraseCard writes one empty record and keeps the reads from the page meanwhile', async () => {
    const { nfc, onRead, steps, results } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Svuota la card' }));
    expect(steps).toEqual(['waiting-card']);

    // The card is held to the phone, with its link: it goes to the writer, not to the page.
    act(() => {
      nfc.read(UID, { urls: [URL] });
    });
    expect(steps).toEqual(['waiting-card', 'writing']);
    await settle();
    expect(steps).toEqual(['waiting-card', 'writing', 'verifying']);
    expect(nfc.writes).toHaveLength(1);
    expect(nfc.writes[0]?.message).toEqual({ records: [{ recordType: 'empty' }] });
    expect(nfc.writes[0]?.options.overwrite).toBe(true);

    // Read back blank: the card is erased.
    act(() => {
      nfc.read(UID, { empties: 1 });
    });
    await settle();
    expect(results).toEqual([{ ok: true }]);
    expect(onRead).not.toHaveBeenCalled();
    expect(nfc.makeReadOnlyCalls()).toBe(0);

    // Once the erase is over, the page gets the reads again.
    act(() => {
      nfc.read(UID);
    });
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('eraseCard while the link is being written: busy, and the write goes on', async () => {
    const { nfc, reader, steps, results } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Scrivi il link' }));
    await expect(reader.eraseCard({ expectedUid: UID })).resolves.toEqual({
      ok: false,
      reason: 'busy',
    });
    expect(nfc.writes).toHaveLength(0);

    act(() => {
      nfc.read(UID);
    });
    await settle();
    act(() => {
      nfc.read(UID, { urls: [URL] });
    });
    await settle();
    expect(steps).toEqual(['waiting-card', 'writing', 'verifying']);
    expect(results).toEqual([{ ok: true }]);
  });
});
