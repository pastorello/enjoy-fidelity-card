import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeCustomerService } from '../../test/fakeCustomerService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const OPERATOR = { id: 'op-2', name: 'Marco Prova', role: 'operator' } as const;

describe('Catalogo premi page', () => {
  it('shows the catalogue title and a back link to the settings to administrators', async () => {
    const { router } = renderApp('/impostazioni/premi', signedInFake());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Catalogo premi' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Solo per gli amministratori')).not.toBeInTheDocument();
    const back = screen.getByRole('link', { name: 'Indietro' });
    expect(back).toHaveAttribute('href', '/impostazioni');
    await userEvent.click(back);
    expect(router.state.location.pathname).toBe('/impostazioni');
  });

  it('tells an operator who opens the URL that the catalogue is for administrators, without calling the service', async () => {
    const rewards = createFakeRewardsService();
    const { router } = renderApp(
      '/impostazioni/premi',
      signedInFake({ operator: OPERATOR }),
      createFakeSettingsService(),
      createFakeCustomerService(),
      rewards,
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Solo per gli amministratori' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Il catalogo premi lo gestiscono gli amministratori.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Catalogo premi' })).toBeInTheDocument();
    // No "Nuovo premio" box for an operator.
    expect(screen.queryByText(/Nuovo premio/)).not.toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Torna alle impostazioni' });
    expect(link).toHaveAttribute('href', '/impostazioni');
    expect(link).toHaveAttribute('data-variant', 'secondary');
    expect(rewards.calls).toEqual([]);

    await userEvent.click(link);
    expect(router.state.location.pathname).toBe('/impostazioni');
    expect(rewards.calls).toEqual([]);
  });
});
