import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp, signedInFake } from '../../test/renderApp';

describe('GESTIONE section of the settings', () => {
  it('offers "Catalogo premi" to administrators', async () => {
    const { router } = renderApp('/impostazioni', signedInFake());
    const section = await screen.findByRole('region', { name: 'GESTIONE' });
    expect(
      within(section).getByRole('heading', { level: 2, name: 'GESTIONE' }),
    ).toBeInTheDocument();
    const rows = within(section).getAllByRole('link');
    // As in the wireframe: the "Operatori" row of operators, then the catalogue row of rewards.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAccessibleName(/^Operatori/);
    expect(rows[1]).toHaveAccessibleName(/^Catalogo premi/);
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    const row = within(section).getByRole('link', { name: /Catalogo premi/ });
    expect(row).toHaveTextContent('Premi fissi e punti richiesti');
    expect(row).toHaveAttribute('href', '/impostazioni/premi');
    await userEvent.click(row);
    expect(router.state.location.pathname).toBe('/impostazioni/premi');
  });

  it('is not shown to operators', async () => {
    renderApp(
      '/impostazioni',
      signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role: 'operator' } }),
    );
    await screen.findByRole('region', { name: 'ACCOUNT' });
    expect(screen.queryByRole('region', { name: 'GESTIONE' })).not.toBeInTheDocument();
    expect(screen.queryByText('GESTIONE')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Catalogo premi/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Operatori/ })).not.toBeInTheDocument();
  });
});
