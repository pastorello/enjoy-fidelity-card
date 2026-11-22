import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeDevice } from '../../test/fakeAuthService';
import { renderApp, signedInFake } from '../../test/renderApp';

/** A promise the test rejects by hand (the app's TS lib predates Promise.withResolvers). */
function failable() {
  let fail!: (error: Error) => void;
  const promise = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  return { promise, fail };
}

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

  describe('operator account at every route change', () => {
    const NOT_ENABLED = 'Account non abilitato: chiedi a un amministratore.';
    const marco = { id: 'op-2', name: 'Marco Prova', role: 'operator' as const };

    it('does not read the identity again on the first page: it was just checked', async () => {
      const { fake } = renderApp('/', signedInFake());
      await screen.findByRole('main');
      expect(fake.service.loadIdentity).toHaveBeenCalledOnce();
    });

    it('sends a deactivated operator to /accedi with the message at the next route change', async () => {
      const { router, fake } = renderApp('/', signedInFake({ operator: marco }));
      await screen.findByRole('heading', { level: 1, name: 'Enjoy Card' });

      fake.removeProfile();
      await act(() => router.navigate('/impostazioni'));

      await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
      expect(await screen.findByText(NOT_ENABLED)).toBeInTheDocument();
      expect(fake.service.signOut).toHaveBeenCalledOnce();
    });

    it('shows the settings of the new role at the next route change', async () => {
      const { router, fake } = renderApp('/', signedInFake({ operator: marco }));
      await screen.findByRole('heading', { level: 1, name: 'Enjoy Card' });

      // Promoted to administrator: the complete settings.
      fake.setProfile({ ...marco, role: 'admin' });
      await act(() => router.navigate('/impostazioni'));
      expect(await screen.findByRole('region', { name: 'GESTIONE' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'PUNTI E CONTROLLI' })).toBeInTheDocument();

      // Back to operator: the reduced settings.
      fake.setProfile(marco);
      await act(() => router.navigate('/'));
      await screen.findByRole('heading', { level: 1, name: 'Enjoy Card' });
      await act(() => router.navigate('/impostazioni'));
      expect(await screen.findByRole('region', { name: 'PUNTI' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'GESTIONE' })).not.toBeInTheDocument();
    });

    it('reads the identity once per route change', async () => {
      const { router, fake } = renderApp('/', signedInFake());
      await screen.findByRole('heading', { level: 1, name: 'Enjoy Card' });

      await act(() => router.navigate('/impostazioni'));
      await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
      await waitFor(() => expect(fake.service.loadIdentity).toHaveBeenCalledTimes(2));
      await act(() => router.navigate('/'));
      await screen.findByRole('heading', { level: 1, name: 'Enjoy Card' });
      await waitFor(() => expect(fake.service.loadIdentity).toHaveBeenCalledTimes(3));
    });

    it('keeps the page on screen while the check runs and when it fails offline', async () => {
      const { router, fake } = renderApp('/', signedInFake());
      await screen.findByRole('heading', { level: 1, name: 'Enjoy Card' });

      const pending = failable();
      fake.service.loadIdentity.mockImplementationOnce(() => pending.promise);
      await act(() => router.navigate('/impostazioni'));
      // Not blocked: the page shows at once, without a loading view.
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Impostazioni' }),
      ).toBeInTheDocument();
      expect(fake.service.loadIdentity).toHaveBeenCalledTimes(2);

      await act(async () => pending.fail(new Error('offline')));
      expect(router.state.location.pathname).toBe('/impostazioni');
      expect(screen.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeInTheDocument();
      expect(fake.service.signOut).not.toHaveBeenCalled();
    });
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
