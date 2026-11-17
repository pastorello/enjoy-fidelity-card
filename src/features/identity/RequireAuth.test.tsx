import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, signedInFake } from '../../test/renderApp';

describe('RequireAuth', () => {
  it('sends to /accedi with the not-enabled message when the profile is removed while the app is open', async () => {
    const { router, fake } = renderApp('/', signedInFake());
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await screen.findByRole('main');

    fake.removeProfile();
    act(() => {
      fireEvent.focus(window);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
    expect(fake.service.signOut).toHaveBeenCalledOnce();
  });

  it('sends to /accedi with the expired message when the session ends on its own', async () => {
    const { router, fake } = renderApp('/', signedInFake());
    await screen.findByRole('main');

    act(() => fake.endSession());

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(await screen.findByText('La sessione è scaduta: accedi di nuovo.')).toBeInTheDocument();
  });
});
