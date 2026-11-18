import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeCustomerService } from '../../test/fakeCustomerService';
import { CustomerServiceProvider, useCustomerService } from './CustomerServiceProvider';

function Probe() {
  const service = useCustomerService();
  return <p>{typeof service.search}</p>;
}

describe('CustomerServiceProvider', () => {
  it('gives its service to useCustomerService', () => {
    const { service } = createFakeCustomerService();
    function SearchProbe() {
      const injected = useCustomerService();
      return <p>{injected === service ? 'same' : 'other'}</p>;
    }
    render(
      <CustomerServiceProvider service={service}>
        <Probe />
        <SearchProbe />
      </CustomerServiceProvider>,
    );
    expect(screen.getByText('function')).toBeInTheDocument();
    expect(screen.getByText('same')).toBeInTheDocument();
  });

  it('useCustomerService outside the provider throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/CustomerServiceProvider/);
    vi.restoreAllMocks();
  });
});
