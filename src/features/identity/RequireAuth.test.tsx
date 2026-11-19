import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeDevice } from '../../test/fakeAuthService';
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

  describe('device session', () => {
    const cashier = { id: 'op-2', name: 'Marco Prova', role: 'operator' as const };

    it('shows the pages to a device with a cashier, with the settings loaded for that cashier', async () => {
      const { router, settings } = renderApp('/', signedInFake({ device: fakeDevice, cashier }));
      await screen.findByRole('main');
      expect(router.state.location.pathname).toBe('/');
      await waitFor(() => expect(settings.service.load).toHaveBeenCalledOnce());
    });

    it('keeps a device without a cashier away from the pages and the settings', async () => {
      const { router, settings } = renderApp('/', signedInFake({ device: fakeDevice }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
      expect(settings.service.load).not.toHaveBeenCalled();
    });

    it('sends to /accedi with the not-enabled message when the device account is removed', async () => {
      const { router, fake } = renderApp('/', signedInFake({ device: fakeDevice, cashier }));
      await screen.findByRole('main');

      fake.removeProfile();
      act(() => {
        fireEvent.focus(window);
      });

      await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
      expect(
        await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
      ).toBeInTheDocument();
    });
  });
});
