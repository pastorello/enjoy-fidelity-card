import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CardReaderState } from '../card-input/cardReader';
import { UsbReaderStatusView } from './UsbReaderStatus';

// SPEC-tablet-kiosk, point 8 and Open Questions 7: the indicator in the reader column of Cerca.

const READY = 'Lettore USB pronto';
const UNRECOGNIZED = 'Codice non riconosciuto: controlla il formato del lettore in Impostazioni';

function usb(patch: Partial<CardReaderState['usb']> = {}): CardReaderState['usb'] {
  return { enabled: true, format: 'hex', lastReadAt: null, lastInvalidAt: null, ...patch };
}

function status() {
  return screen.getByRole('status', { name: 'Stato del lettore USB' });
}

describe('UsbReaderStatusView', () => {
  it('says "Lettore USB pronto" before any read', () => {
    render(<UsbReaderStatusView usb={usb()} />);
    expect(status()).toHaveTextContent(READY);
  });

  it('says "Codice non riconosciuto…" when the last read was invalid', () => {
    render(<UsbReaderStatusView usb={usb({ lastInvalidAt: 2000 })} />);
    expect(status()).toHaveTextContent(UNRECOGNIZED);
    render(<UsbReaderStatusView usb={usb({ lastReadAt: 1000, lastInvalidAt: 2000 })} />);
    expect(screen.getAllByText(UNRECOGNIZED)).toHaveLength(2);
  });

  it('goes back to "Lettore USB pronto" after a valid read newer than the invalid one', () => {
    render(<UsbReaderStatusView usb={usb({ lastReadAt: 3000, lastInvalidAt: 2000 })} />);
    expect(status()).toHaveTextContent(READY);
  });

  it('says nothing while the reader is off (settings not loaded): it is not ready', () => {
    render(<UsbReaderStatusView usb={usb({ enabled: false, format: null })} />);
    // The live region stays mounted, empty, so the first state is announced when it arrives.
    expect(status()).toHaveTextContent('');
    expect(screen.queryByText(READY)).not.toBeInTheDocument();
  });
});
