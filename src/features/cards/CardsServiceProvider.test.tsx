import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeCardsService } from '../../test/fakeCardsService';
import { CardsServiceProvider, useCardsService } from './CardsServiceProvider';

function Probe() {
  const service = useCardsService();
  return <p>{typeof service.lookup}</p>;
}

describe('CardsServiceProvider', () => {
  it('gives its service to useCardsService', () => {
    const { service } = createFakeCardsService();
    function SameProbe() {
      const injected = useCardsService();
      return <p>{injected === service ? 'same' : 'other'}</p>;
    }
    render(
      <CardsServiceProvider service={service}>
        <Probe />
        <SameProbe />
      </CardsServiceProvider>,
    );
    expect(screen.getByText('function')).toBeInTheDocument();
    expect(screen.getByText('same')).toBeInTheDocument();
  });

  it('useCardsService outside the provider throws a clear error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(
      'useCardsService must be used inside <CardsServiceProvider>',
    );
    vi.restoreAllMocks();
  });
});
