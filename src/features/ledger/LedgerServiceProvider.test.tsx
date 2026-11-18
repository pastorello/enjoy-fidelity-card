import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeLedgerService } from '../../test/fakeLedgerService';
import { LedgerServiceProvider, useLedgerService } from './LedgerServiceProvider';

function Probe() {
  const service = useLedgerService();
  return <p>{typeof service.recordPurchase}</p>;
}

describe('LedgerServiceProvider', () => {
  it('gives its service to useLedgerService', () => {
    const { service } = createFakeLedgerService();
    function SameProbe() {
      const injected = useLedgerService();
      return <p>{injected === service ? 'same' : 'other'}</p>;
    }
    render(
      <LedgerServiceProvider service={service}>
        <Probe />
        <SameProbe />
      </LedgerServiceProvider>,
    );
    expect(screen.getByText('function')).toBeInTheDocument();
    expect(screen.getByText('same')).toBeInTheDocument();
  });

  it('useLedgerService outside the provider throws a clear error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(
      'useLedgerService must be used inside <LedgerServiceProvider>',
    );
    vi.restoreAllMocks();
  });
});
