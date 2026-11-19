import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { fakeDevice } from '../../test/fakeAuthService';
import { createFakeKioskService, fakeCashier, KIOSK_LOCK_MS } from '../../test/fakeKioskService';
import { renderApp, signedInFake } from '../../test/renderApp';

const SEARCH_LABEL = 'Oppure cerca per nome o telefono';
const EXPLANATION =
  'Sul tablet condiviso si cambia operatore con il PIN personale di 4 cifre. Spese e riscatti vengono registrati a nome di chi è alla cassa.';
const LOCK_NOTE = 'Dopo 5 PIN errati il cambio si blocca per qualche minuto.';
const NO_PIN_YET =
  'Nessuno ha ancora impostato il PIN: ognuno lo imposta dal proprio telefono, in Impostazioni';
const NETWORK = 'Connessione assente. Riprova.';

afterEach(() => {
  vi.useRealTimers();
});

const giulia = () => fakeCashier({ name: 'Giulia Prova', role: 'admin', pin: '1234' });
const marco = () => fakeCashier({ name: 'Marco Prova', pin: '5678' });
const sara = () => fakeCashier({ name: 'Sara Prova', pin: null });

/** /cassa on a device whose cashier, turn and lock are the kiosk fake's, as on the server. */
function openTill(kiosk = createFakeKioskService({ cashiers: [marco(), sara(), giulia()] })) {
  const fake = signedInFake();
  fake.setDevice(fakeDevice, () => kiosk.device());
  const view = renderApp(
    '/cassa',
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
  return { ...view, kiosk, fake };
}

function operators() {
  return screen.getByRole('group', { name: 'Operatori' });
}

async function findOperator(name: string) {
  return within(await screen.findByRole('group', { name: 'Operatori' })).findByRole('button', {
    name: new RegExp(`^${name}`),
  });
}

function pinPanel() {
  return screen.getByRole('complementary', { name: 'PIN' });
}

function keypad() {
  return within(pinPanel()).getByRole('group', { name: 'Tastierino PIN' });
}

function key(name: string) {
  return within(keypad()).getByRole('button', { name });
}

function dots() {
  return within(pinPanel()).getByRole('img', { name: / su 4 inserit[ae]$/ });
}

/** Taps the keys one by one, as fingers do. */
function tap(...names: string[]) {
  for (const name of names) fireEvent.click(key(name));
}

describe('CashierPage, "Chi è alla cassa?"', () => {
  it('lists the operators in alphabetical order, none chosen, with the keypad off', async () => {
    openTill();

    const giuliaButton = await findOperator('Giulia Prova');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Chi è alla cassa?' }),
    ).toBeInTheDocument();
    // Header without a cashier and without the account button.
    expect(screen.getByRole('heading', { level: 1, name: 'Enjoy Card' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Account e impostazioni/ })).not.toBeInTheDocument();

    const names = within(operators())
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(names).toEqual([
      'GGiulia ProvaAmministratore',
      'MMarco ProvaOperatore',
      'SSara ProvaOperatorePIN da impostare dal telefono',
    ]);
    expect(giuliaButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(EXPLANATION)).toBeInTheDocument();

    expect(within(pinPanel()).getByRole('heading', { name: 'Tocca il tuo nome' })).toBeVisible();
    expect(keypad()).toBeDisabled();
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
    expect(within(pinPanel()).getByText(LOCK_NOTE)).toBeInTheDocument();
  });

  it('shows an operator without a PIN disabled, with "PIN da impostare dal telefono" (criterion 3)', async () => {
    openTill();
    const saraButton = await findOperator('Sara Prova');
    expect(saraButton).toBeDisabled();
    expect(within(saraButton).getByText('PIN da impostare dal telefono')).toBeInTheDocument();
  });

  it('choosing a name turns the keypad on; choosing another empties the PIN', async () => {
    openTill();
    fireEvent.click(await findOperator('Giulia Prova'));

    expect(await findOperator('Giulia Prova')).toHaveAttribute('aria-pressed', 'true');
    expect(within(pinPanel()).getByRole('heading', { name: 'PIN di Giulia Prova' })).toBeVisible();
    expect(keypad()).toBeEnabled();
    tap('1', '2');
    expect(dots()).toHaveAccessibleName('2 cifre su 4 inserite');

    fireEvent.click(await findOperator('Marco Prova'));

    expect(await findOperator('Marco Prova')).toHaveAttribute('aria-pressed', 'true');
    expect(await findOperator('Giulia Prova')).toHaveAttribute('aria-pressed', 'false');
    expect(within(pinPanel()).getByRole('heading', { name: 'PIN di Marco Prova' })).toBeVisible();
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
  });

  it('verifies by itself at the 4th digit and goes to the home with the cashier (criterion 2)', async () => {
    const { kiosk, router } = openTill();
    fireEvent.click(await findOperator('Giulia Prova'));

    tap('1', '2', '3');
    expect(kiosk.service.unlock).not.toHaveBeenCalled();
    tap('4');

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('searchbox', { name: SEARCH_LABEL })).toBeInTheDocument();
    expect(kiosk.service.unlock).toHaveBeenCalledOnce();
    expect(kiosk.device().cashier?.name).toBe('Giulia Prova');
  });

  it('keeps the keypad and the names off while the PIN is being checked', async () => {
    const { kiosk } = openTill();
    fireEvent.click(await findOperator('Giulia Prova'));
    const held = kiosk.holdNext('unlock');

    tap('1', '2', '3', '4');

    await waitFor(() => expect(keypad()).toBeDisabled());
    expect(await findOperator('Marco Prova')).toBeDisabled();
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
  });

  it('a wrong PIN empties the dots and says how many attempts are left', async () => {
    const { kiosk, router } = openTill();
    fireEvent.click(await findOperator('Marco Prova'));

    tap('0', '0', '0', '0');

    expect(await screen.findByRole('alert')).toHaveTextContent('PIN errato. Tentativi rimasti: 4');
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
    expect(keypad()).toBeEnabled();
    expect(router.state.location.pathname).toBe('/cassa');
    expect(kiosk.device().cashier).toBeNull();

    // Another name clears the message and starts again.
    fireEvent.click(await findOperator('Giulia Prova'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('the 5th wrong PIN locks the change with the server seconds, counting down (criterion 3)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { kiosk } = openTill();
    fireEvent.click(await findOperator('Marco Prova'));

    tap('0', '0', '0', '0');
    await screen.findByText('PIN errato. Tentativi rimasti: 4');
    tap('0', '0', '0', '0');
    await screen.findByText('PIN errato. Tentativi rimasti: 3');
    tap('0', '0', '0', '0');
    await screen.findByText('PIN errato. Tentativi rimasti: 2');
    tap('0', '0', '0', '0');
    await screen.findByText('PIN errato. Tentativi rimasti: 1');
    tap('0', '0', '0', '0');

    expect(await screen.findByText('Troppi tentativi: riprova tra 5:00')).toBeInTheDocument();
    expect(keypad()).toBeDisabled();
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');

    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(screen.getByText('Troppi tentativi: riprova tra 3:59')).toBeInTheDocument();
    expect(keypad()).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(KIOSK_LOCK_MS - 61_000));
    expect(screen.queryByText(/^Troppi tentativi/)).not.toBeInTheDocument();
    expect(keypad()).toBeEnabled();
    expect(kiosk.service.unlock).toHaveBeenCalledTimes(5);
  });

  it('opens already locked when the server says so, and counts down from its seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    openTill(createFakeKioskService({ cashiers: [giulia()], lockedForMs: 65_000 }));

    expect(await screen.findByText('Troppi tentativi: riprova tra 1:05')).toBeInTheDocument();
    fireEvent.click(await findOperator('Giulia Prova'));
    expect(keypad()).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText('Troppi tentativi: riprova tra 1:04')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(64_000));
    expect(screen.queryByText(/^Troppi tentativi/)).not.toBeInTheDocument();
    expect(keypad()).toBeEnabled();
  });

  it('without the network: "Connessione assente. Riprova.", PIN emptied, never sent again', async () => {
    const { kiosk, router } = openTill();
    fireEvent.click(await findOperator('Giulia Prova'));
    kiosk.setNetworkDown(true);

    tap('1', '2', '3', '4');

    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK);
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
    expect(keypad()).toBeEnabled();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(kiosk.service.unlock).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/cassa');

    // Back online, the PIN typed again goes through.
    kiosk.setNetworkDown(false);
    tap('1', '2', '3', '4');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('a server fault while checking says so, with the PIN emptied', async () => {
    const { kiosk } = openTill();
    fireEvent.click(await findOperator('Giulia Prova'));
    kiosk.failNext('unlock', new ServerFaultError('unavailable'));

    tap('1', '2', '3', '4');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Servizio momentaneamente non disponibile: riprova tra poco.',
    );
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
  });

  it('a PIN removed meanwhile (no_pin): the name is off with "PIN da impostare dal telefono"', async () => {
    const chosen = giulia();
    const kiosk = createFakeKioskService({ cashiers: [marco(), chosen] });
    const { router } = openTill(kiosk);
    fireEvent.click(await findOperator('Giulia Prova'));
    kiosk.removePin(chosen.id);

    tap('1', '2', '3', '4');

    expect(await screen.findByRole('alert')).toHaveTextContent('PIN da impostare dal telefono');
    const button = await findOperator('Giulia Prova');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('PIN da impostare dal telefono');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(keypad()).toBeDisabled();
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
    expect(router.state.location.pathname).toBe('/cassa');
  });

  it('refused (not a device any more): the identity is checked again, back to /accedi', async () => {
    const { kiosk, router, fake } = openTill();
    fireEvent.click(await findOperator('Giulia Prova'));
    kiosk.failNext('unlock', 'forbidden');
    fake.removeProfile();

    tap('1', '2', '3', '4');

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });

  it('nobody with a PIN: says that everyone sets it from their phone', async () => {
    openTill(createFakeKioskService({ cashiers: [sara()] }));
    expect(await screen.findByText(NO_PIN_YET)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tastierino PIN' })).not.toBeInTheDocument();
  });

  it('shows the loading state, then the operators', async () => {
    const kiosk = createFakeKioskService({ cashiers: [giulia()] });
    const held = kiosk.holdNext('listCashiers');
    openTill(kiosk);

    // The till's own loading state, inside the shell (the session's check shows one before it).
    await screen.findByRole('heading', { level: 1, name: 'Enjoy Card' });
    expect(screen.getByText('Caricamento…')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Operatori' })).not.toBeInTheDocument();
    held.release();
    expect(await findOperator('Giulia Prova')).toBeInTheDocument();
  });

  it('a list that does not load offers "Riprova"', async () => {
    const kiosk = createFakeKioskService({ cashiers: [giulia()] });
    kiosk.failNext('listCashiers', 'network');
    openTill(kiosk);

    fireEvent.click(await screen.findByRole('button', { name: 'Riprova' }));

    expect(await findOperator('Giulia Prova')).toBeInTheDocument();
    expect(kiosk.service.listCashiers).toHaveBeenCalledTimes(2);
  });

  describe('physical keys (criterion 5)', () => {
    it('digits and Enter from the keyboard change nothing, even with a key focused', async () => {
      const user = userEvent.setup();
      const { kiosk, router } = openTill();
      await user.click(await findOperator('Giulia Prova'));

      key('1').focus();
      await user.keyboard('1234{Enter}');
      key('5').focus();
      await user.keyboard('{Enter}[Space]');

      expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
      expect(kiosk.service.unlock).not.toHaveBeenCalled();
      expect(router.state.location.pathname).toBe('/cassa');
    });

    it('Enter on a focused name does not choose it', async () => {
      const user = userEvent.setup();
      openTill();
      const marcoButton = await findOperator('Marco Prova');

      marcoButton.focus();
      await user.keyboard('{Enter}');

      expect(marcoButton).toHaveAttribute('aria-pressed', 'false');
      expect(keypad()).toBeDisabled();
    });

    it('a card burst on /cassa is stopped before the page sees it', async () => {
      openTill();
      await findOperator('Giulia Prova');
      for (const keyName of ['0', '4', 'A', '1', 'Enter']) {
        expect(fireEvent.keyDown(document.body, { key: keyName })).toBe(false);
      }
    });
  });
});
