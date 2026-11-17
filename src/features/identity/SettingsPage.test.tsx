import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp, signedInFake } from '../../test/renderApp';

describe('settings page', () => {
  it('shows who is signed in, with the role in Italian', async () => {
    renderApp(
      '/impostazioni',
      signedInFake({ operator: { id: 'op-2', name: 'marco Prova', role: 'operator' } }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Impostazioni' }),
    ).toBeInTheDocument();
    const account = screen.getByRole('region', { name: 'Account' });
    expect(within(account).getByText('marco Prova')).toBeInTheDocument();
    expect(within(account).getByText('Operatore')).toBeInTheDocument();
    expect(within(account).getByText('M')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/');
  });

  it('labels administrators', async () => {
    renderApp('/impostazioni', signedInFake());
    const account = await screen.findByRole('region', { name: 'Account' });
    expect(within(account).getByText('Amministratore')).toBeInTheDocument();
  });

  it('"Esci" ends the session and opens the sign-in page', async () => {
    const { router, fake } = renderApp('/impostazioni', signedInFake());
    await userEvent.click(await screen.findByRole('button', { name: 'Esci' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(fake.service.signOut).toHaveBeenCalledOnce();
    // A plain sign-out is not an expired session.
    expect(screen.queryByText(/sessione è scaduta/)).not.toBeInTheDocument();
  });

  it('is reached from the account button of the home', async () => {
    const { router } = renderApp('/', signedInFake());
    await userEvent.click(
      await screen.findByRole('link', { name: 'Account e impostazioni: Giulia Prova' }),
    );
    expect(router.state.location.pathname).toBe('/impostazioni');
  });
});
