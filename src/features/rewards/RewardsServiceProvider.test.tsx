import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeRewardsService, fakeReward } from '../../test/fakeRewardsService';
import { RewardsServiceProvider, useRewards, useRewardsService } from './RewardsServiceProvider';

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

function renderRewards(fake: ReturnType<typeof createFakeRewardsService>) {
  function wrapper({ children }: { children: ReactNode }) {
    return <RewardsServiceProvider service={fake.service}>{children}</RewardsServiceProvider>;
  }
  return renderHook(() => useRewards(), { wrapper });
}

describe('useRewards', () => {
  const coffee = fakeReward({ name: 'Caffè', points: 50 });
  const dessert = fakeReward({ name: 'Dolce del giorno', points: 120, active: false });
  const aperitif = fakeReward({ name: 'Aperitivo', points: 200 });

  it('loads the whole catalogue once, in sortRewards() order', async () => {
    const fake = createFakeRewardsService({ rewards: [dessert, aperitif, coffee] });
    fake.service.listAll.mockResolvedValueOnce([dessert, aperitif, coffee]);
    const { result } = renderRewards(fake);
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.status === 'done' && result.current.rewards).toEqual([
      coffee,
      aperitif,
      dessert,
    ]);
    // The programmed answer bypasses the fake's log: count the calls on the mock.
    expect(fake.service.listAll).toHaveBeenCalledTimes(1);
  });

  it('an error, then reload: loading again, then the rewards', async () => {
    const fake = createFakeRewardsService({ rewards: [coffee] });
    fake.failNext('listAll', 'network');
    const { result } = renderRewards(fake);
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.reload());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.status === 'done' && result.current.rewards).toEqual([coffee]);
  });

  it('a reload keeps the list shown until its answer, and a failed reload keeps it', async () => {
    const fake = createFakeRewardsService({ rewards: [coffee] });
    const { result } = renderRewards(fake);
    await waitFor(() => expect(result.current.status).toBe('done'));

    const held = fake.holdNext('listAll');
    fake.failNext('listAll', 'network');
    act(() => result.current.reload());
    expect(result.current.status === 'done' && result.current.rewards).toEqual([coffee]);
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    expect(result.current.status === 'done' && result.current.rewards).toEqual([coffee]);
    expect(fake.calls).toHaveLength(2);
  });

  it('drops an answer superseded by a newer reload', async () => {
    const fake = createFakeRewardsService({ rewards: [coffee] });
    const { result } = renderRewards(fake);
    await waitFor(() => expect(result.current.status).toBe('done'));

    const slow = fake.holdNext('listAll');
    act(() => result.current.reload());
    fake.service.listAll.mockResolvedValueOnce([]);
    act(() => result.current.reload());
    await waitFor(() =>
      expect(result.current.status === 'done' && result.current.rewards).toEqual([]),
    );
    await act(async () => {
      slow.release();
      await Promise.resolve();
    });
    expect(result.current.status === 'done' && result.current.rewards).toEqual([]);
  });
});
