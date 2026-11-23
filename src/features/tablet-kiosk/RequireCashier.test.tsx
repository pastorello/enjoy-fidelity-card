import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDevice } from '../../test/fakeAuthService';
import { createFakeCustomerService } from '../../test/fakeCustomerService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeKioskService, fakeCashier, KIOSK_TURN_MS } from '../../test/fakeKioskService';
import { createFakeSettingsService, defaultSettings } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const TURN_ENDED = 'Turno scaduto: inserisci di nuovo il PIN';
const SEARCH_LABEL = 'Oppure cerca per nome o email';
const cashier = { id: 'op-2', name: 'Marco Prova', role: 'operator' as const };

afterEach(() => {
  vi.useRealTimers();
});

/** A device whose cashier's turn has just started. */
function deviceWithCashier() {
  return signedInFake({ device: fakeDevice, cashier });
}

function visible() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('RequireCashier', () => {
  it('sends a device without a cashier from / to /cassa, without the turn-ended message', async () => {
    const { router, settings, card } = renderApp(
      '/',
      signedInFake({ device: fakeDevice }),
      undefined,
      undefined,
      undefined,
      createTestCardReader(),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Chi è alla cassa?' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(TURN_ENDED)).not.toBeInTheDocument();
    expect(settings.service.load).not.toHaveBeenCalled();
    expect(card.activate).not.toHaveBeenCalled();
  });

  it('sends an operator who opens /cassa to the home', async () => {
    const { router } = renderApp('/cassa', signedInFake());
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('searchbox', { name: SEARCH_LABEL })).toBeInTheDocument();
  });

  it('reads the identity again at every route change and sends an ended turn to /cassa', async () => {
    const fake = deviceWithCashier();
    const { router } = renderApp('/', fake);
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });
    const reads = fake.service.loadIdentity.mock.calls.length;

    await act(() => router.navigate('/impostazioni'));
    await waitFor(() => expect(fake.service.loadIdentity.mock.calls.length).toBeGreaterThan(reads));
    expect(router.state.location.pathname).toBe('/impostazioni');

    fake.expireTurn();
    await act(() => router.navigate('/'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(await screen.findByText(TURN_ENDED)).toBeInTheDocument();
  });

  it('reads the identity again when the app comes back to the foreground', async () => {
    const fake = deviceWithCashier();
    const { router } = renderApp('/', fake);
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });

    fake.expireTurn();
    visible();

    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(await screen.findByText(TURN_ENDED)).toBeInTheDocument();
  });

  it('goes back to /cassa at the end of the turn given by the server, without a route change', async () => {
    // Before the render, so the timer of the turn is a fake one; time still runs for findBy.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fake = deviceWithCashier();
    const { router } = renderApp('/', fake);
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });

    await act(() => vi.advanceTimersByTimeAsync(KIOSK_TURN_MS - 60_000));
    expect(router.state.location.pathname).toBe('/');

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(router.state.location.pathname).toBe('/cassa');
    expect(screen.getByText(TURN_ENDED)).toBeInTheDocument();
  });

  it('ends the turn at its time even when the identity cannot be read then', async () => {
    // Before the render, so the timer of the turn is a fake one; time still runs for findBy.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fake = deviceWithCashier();
    const { router } = renderApp('/', fake);
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });
    fake.service.loadIdentity.mockRejectedValue(new Error('offline'));

    await act(() => vi.advanceTimersByTimeAsync(KIOSK_TURN_MS));

    expect(router.state.location.pathname).toBe('/cassa');
    expect(screen.getByText(TURN_ENDED)).toBeInTheDocument();
  });

  it('on a device, a "not an operator" refusal sends to /cassa instead of /accedi', async () => {
    const fake = deviceWithCashier();
    const customers = createFakeCustomerService();
    const { router } = renderApp('/', fake, createFakeSettingsService(), customers);
    const field = await screen.findByRole('searchbox', { name: SEARCH_LABEL });

    fake.expireTurn();
    customers.failNext('list', 'not_operator');
    fireEvent.change(field, { target: { value: 'rossi' } });

    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(await screen.findByText(TURN_ENDED)).toBeInTheDocument();
    expect(fake.service.signOut).not.toHaveBeenCalled();
  });

  it('on an operator account, the same refusal still sends to /accedi (identity)', async () => {
    const fake = signedInFake();
    const customers = createFakeCustomerService();
    const { router } = renderApp('/', fake, createFakeSettingsService(), customers);
    const field = await screen.findByRole('searchbox', { name: SEARCH_LABEL });

    fake.removeProfile();
    customers.failNext('list', 'not_operator');
    fireEvent.change(field, { target: { value: 'rossi' } });

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
  });

  describe('card reading (success criterion 5)', () => {
    it('keeps the USB reader off on /cassa', async () => {
      const card = createTestCardReader();
      const { router } = renderApp(
        '/',
        signedInFake({ device: fakeDevice }),
        undefined,
        undefined,
        undefined,
        card,
      );
      await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
      await screen.findByRole('heading', { level: 2, name: 'Chi è alla cassa?' });
      expect(card.reader.getState().usb.enabled).toBe(false);
      expect(card.activate).not.toHaveBeenCalled();
    });

    it('turns the USB reader on with the format of the settings while the turn lasts, off after it', async () => {
      const card = createTestCardReader();
      const fake = deviceWithCashier();
      const settings = createFakeSettingsService({
        settings: { ...defaultSettings, usbUidFormat: 'dec-reversed' },
      });
      const { router } = renderApp('/', fake, settings, undefined, undefined, card);
      await waitFor(() =>
        expect(card.reader.getState().usb).toMatchObject({
          enabled: true,
          format: 'dec-reversed',
        }),
      );

      fake.expireTurn();
      visible();

      await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
      expect(card.reader.getState().usb.enabled).toBe(false);
      expect(card.deactivate).toHaveBeenCalled();
    });
  });

  it('loads the settings again for the next cashier', async () => {
    const fake = deviceWithCashier();
    const { router, settings } = renderApp('/', fake);
    await waitFor(() => expect(settings.service.load).toHaveBeenCalledOnce());

    fake.setCashier({ id: 'op-3', name: 'Sara Prova', role: 'admin' });
    await act(() => router.navigate('/impostazioni'));

    await waitFor(() => expect(settings.service.load).toHaveBeenCalledTimes(2));
    expect(router.state.location.pathname).toBe('/impostazioni');
  });

  it('a new PIN set elsewhere ends the turn: /cassa at the next route change (criterion 4)', async () => {
    const marco = fakeCashier({ name: 'Marco Prova', pin: '5678' });
    const kiosk = createFakeKioskService({ cashiers: [marco], cashierId: marco.id });
    const fake = signedInFake();
    fake.setDevice(fakeDevice, () => kiosk.device());
    const { router } = renderApp(
      '/',
      fake,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      kiosk,
    );
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });

    kiosk.setPin(marco.id, '9999');
    expect(router.state.location.pathname).toBe('/');
    await act(() => router.navigate('/impostazioni'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(await screen.findByText(TURN_ENDED)).toBeInTheDocument();
  });
});
