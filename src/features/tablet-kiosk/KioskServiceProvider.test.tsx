import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeKioskService } from '../../test/fakeKioskService';
import { KioskServiceProvider, useKioskService } from './KioskServiceProvider';

function Probe() {
  const service = useKioskService();
  return <p>{typeof service.unlock}</p>;
}

describe('KioskServiceProvider', () => {
  it('gives its service to useKioskService', () => {
    const { service } = createFakeKioskService();
    function SameProbe() {
      const injected = useKioskService();
      return <p>{injected === service ? 'same' : 'other'}</p>;
    }
    render(
      <KioskServiceProvider service={service}>
        <Probe />
        <SameProbe />
      </KioskServiceProvider>,
    );
    expect(screen.getByText('function')).toBeInTheDocument();
    expect(screen.getByText('same')).toBeInTheDocument();
  });

  it('useKioskService outside the provider throws a clear error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(
      'useKioskService must be used inside <KioskServiceProvider>',
    );
    vi.restoreAllMocks();
  });
});
