import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { RewardsServiceProvider, useRewardsService } from './RewardsServiceProvider';

function Probe() {
  const service = useRewardsService();
  return <p>{typeof service.listAll}</p>;
}

describe('RewardsServiceProvider', () => {
  it('gives its service to useRewardsService', () => {
    const { service } = createFakeRewardsService();
    function SameProbe() {
      const injected = useRewardsService();
      return <p>{injected === service ? 'same' : 'other'}</p>;
    }
    render(
      <RewardsServiceProvider service={service}>
        <Probe />
        <SameProbe />
      </RewardsServiceProvider>,
    );
    expect(screen.getByText('function')).toBeInTheDocument();
    expect(screen.getByText('same')).toBeInTheDocument();
  });

  it('useRewardsService outside the provider throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/RewardsServiceProvider/);
    vi.restoreAllMocks();
  });
});
