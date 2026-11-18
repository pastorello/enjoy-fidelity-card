import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { fakeOperator } from '../../test/fakeAuthService';
import { createFakeCardsService } from '../../test/fakeCardsService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeLedgerService } from '../../test/fakeLedgerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService, defaultSettings } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const MARIA = fakeCustomer({ name: 'Maria Rossi', phone: '+393330004521', balance: 120 });
const ERASED = fakeCustomer({
  name: 'cancellato-7f3a',
  anonymizedAt: '2026-11-17T09:00:00.000Z',
  balance: 40,
});
const MISSING_ID = '00000000-0000-4000-8000-00000000dead';

type Options = {
  path?: string;
  auth?: ReturnType<typeof signedInFake>;
  settings?: ReturnType<typeof createFakeSettingsService>;
  customers?: ReturnType<typeof createFakeCustomerService>;
  initialEntries?: string[];
};

function renderPurchase({
  path = `/clienti/${MARIA.id}/spesa`,
  auth = signedInFake(),
  settings = createFakeSettingsService(),
  customers = createFakeCustomerService({ customers: [MARIA, ERASED] }),
}: Options = {}) {
  const rewards = createFakeRewardsService();
  const ledger = createFakeLedgerService({ customers, rewards, settings });
  const rendered = renderApp(
    path,
    auth,
    settings,
    customers,
    rewards,
    createTestCardReader(),
    createFakeCardsService({ customers }),
    ledger,
  );
  return { ...rendered, auth, settings, customers, ledger };
}

function keypad() {
  return screen.getByRole('group', { name: 'Tastierino numerico' });
}

/** Presses the keypad keys one after the other. */
async function press(...names: string[]) {
  await names.reduce<Promise<void>>(
    (previous, name) =>
      previous.then(() => userEvent.click(within(keypad()).getByRole('button', { name }))),
    Promise.resolve(),
  );
}

function amount() {
  return within(screen.getByRole('region', { name: 'Importo' })).getByRole('status');
}

async function ready() {
  await screen.findByRole('link', { name: /Maria Rossi/ });
  return screen.findByRole('button', { name: /^Conferma/ });
}

describe('PurchasePage: Registra spesa', () => {
  it('header "Registra spesa", the customer row to the page, IMPORTO at 0,00 € and the keypad', async () => {
    renderPurchase();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Registra spesa' }),
    ).toBeInTheDocument();
    const row = await screen.findByRole('link', { name: /Maria Rossi/ });
    expect(row).toHaveAttribute('href', `/clienti/${MARIA.id}`);
    expect(row).toHaveTextContent('120 pt');
    const section = screen.getByRole('region', { name: 'Importo' });
    expect(section).toHaveTextContent('IMPORTO');
    expect(amount()).toHaveTextContent('0,00 €');
    expect(amount()).toHaveAttribute('aria-live', 'polite');
    expect(keypad()).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('1-2-5-0 shows "12,50 €", "+12" and the new balance (criterion 1)', async () => {
    renderPurchase();
    await ready();
    await press('1', '2', '5', '0');

    expect(amount()).toHaveTextContent('12,50 €');
    expect(screen.getByText('Punti da aggiungere')).toBeInTheDocument();
    expect(screen.getByText('+12')).toBeInTheDocument();
    expect(
      screen.getByText('1 punto ogni 1,00 €, per difetto · nuovo saldo 132 punti'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conferma +12' })).toBeEnabled();
  });

  it('with a ratio of 250 the same purchase is worth 5 points (criterion 1)', async () => {
    const settings = createFakeSettingsService({
      settings: { ...defaultSettings, centsPerPoint: 250 },
    });
    renderPurchase({ settings });
    await ready();
    await press('1', '2', '5', '0');

    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(
      screen.getByText('1 punto ogni 2,50 €, per difetto · nuovo saldo 125 punti'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conferma +5' })).toBeEnabled();
  });

  it('"Conferma" is disabled at 0, enabled for a purchase worth 0 points, disabled again after deleting', async () => {
    renderPurchase();
    const confirm = await ready();
    expect(confirm).toHaveAccessibleName('Conferma +0');
    expect(confirm).toBeDisabled();

    await press('5', '0');
    expect(screen.getByRole('button', { name: 'Conferma +0' })).toBeEnabled();

    await press('Cancella ultima cifra', 'Cancella ultima cifra');
    expect(screen.getByRole('button', { name: 'Conferma +0' })).toBeDisabled();
  });

  it('"Riscatta premio" opens the rewards of the customer', async () => {
    renderPurchase();
    await ready();
    expect(screen.getByRole('link', { name: 'Riscatta premio' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/premi`,
    );
  });

  it('"Conferma" records the purchase once, even on a double tap', async () => {
    const { ledger } = renderPurchase();
    await ready();
    await press('1', '2', '5', '0');
    const held = ledger.holdNext('recordPurchase');
    const confirm = screen.getByRole('button', { name: 'Conferma +12' });
    await userEvent.dblClick(confirm);
    await act(async () => {
      held.release();
    });

    await waitFor(() => expect(ledger.movements()).toHaveLength(1));
    expect(ledger.service.recordPurchase).toHaveBeenCalledTimes(1);
    expect(ledger.movements()[0]).toMatchObject({
      customerId: MARIA.id,
      kind: 'purchase',
      amountCents: 1250,
      points: 12,
      centsPerPoint: 100,
    });
  });

  it('"Indietro" goes back in the history, to the home without one', async () => {
    const { router } = renderPurchase({ path: '/' });
    await screen.findByRole('heading', { level: 1 });
    await act(async () => {
      await router.navigate(`/clienti/${MARIA.id}`);
    });
    await act(async () => {
      await router.navigate(`/clienti/${MARIA.id}/spesa`);
    });
    await ready();
    const back = within(screen.getByRole('banner')).getByRole('link', { name: 'Indietro' });
    expect(back).toHaveAttribute('href', '/');
    await userEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
  });

  it('"Indietro" without history goes to the home', async () => {
    const { router } = renderPurchase();
    await ready();
    await userEvent.click(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Indietro' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

describe('PurchasePage: Importo insolito', () => {
  it('threshold 150,00 €: 150,01 € shows the warning and "Conferma 150,01 €"; 150,00 € does not (criterion 2)', async () => {
    renderPurchase();
    await ready();
    await press('1', '5', '0', '0', '0');
    expect(amount()).toHaveTextContent('150,00 €');
    expect(screen.queryByText(/Importo insolito/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conferma +150' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Riscatta premio' })).toBeInTheDocument();

    await press('Cancella ultima cifra', '1');
    expect(amount()).toHaveTextContent('150,01 €');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Importo insolito: +150 punti');
    expect(alert).toHaveTextContent(
      'Sopra 150,00 € l’app chiede conferma. Controlla di non aver digitato una cifra in più.',
    );
    expect(screen.queryByText('Punti da aggiungere')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conferma 150,01\u00a0€' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Correggi' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Riscatta premio' })).not.toBeInTheDocument();
    expect(keypad()).toBeInTheDocument();
  });

  it('the threshold in force, and points grouped: 1.250 € → "+1.250 punti", "Conferma 1.250 €"', async () => {
    const settings = createFakeSettingsService({
      settings: { ...defaultSettings, confirmThresholdCents: 50_000 },
    });
    renderPurchase({ settings });
    await ready();
    await press('1', '2', '5', '0', 'Doppio zero');
    expect(amount()).toHaveTextContent('1.250,00 €');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Importo insolito: +1.250 punti');
    expect(alert).toHaveTextContent('Sopra 500,00 € l’app chiede conferma.');
    expect(screen.getByRole('button', { name: 'Conferma 1.250\u00a0€' })).toBeEnabled();
  });

  it('"Correggi" clears the amount and brings back the normal state', async () => {
    const { ledger } = renderPurchase();
    await ready();
    await press('1', '2', '5', '0', 'Doppio zero');
    await userEvent.click(screen.getByRole('button', { name: 'Correggi' }));

    expect(amount()).toHaveTextContent('0,00 €');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conferma +0' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Riscatta premio' })).toBeInTheDocument();
    expect(ledger.service.recordPurchase).not.toHaveBeenCalled();
  });

  it('"Conferma 1.250 €" records at once, with no second dialog, once even on a double tap', async () => {
    const { ledger } = renderPurchase();
    await ready();
    await press('1', '2', '5', '0', 'Doppio zero');
    const held = ledger.holdNext('recordPurchase');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Conferma 1.250\u00a0€' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      held.release();
    });

    await waitFor(() => expect(ledger.movements()).toHaveLength(1));
    expect(ledger.service.recordPurchase).toHaveBeenCalledTimes(1);
    expect(ledger.movements()[0]).toMatchObject({
      customerId: MARIA.id,
      kind: 'purchase',
      amountCents: 125_000,
      points: 1250,
    });
  });
});

describe('PurchasePage: settings not loaded', () => {
  it('while the settings load: the keypad, a loading state, no preview and no "Conferma"', async () => {
    const settings = createFakeSettingsService();
    settings.service.load.mockReturnValue(new Promise(() => {}));
    renderPurchase({ settings });
    await screen.findByRole('link', { name: /Maria Rossi/ });

    expect(keypad()).toBeInTheDocument();
    expect(screen.getByText('Caricamento…')).toBeInTheDocument();
    expect(screen.queryByText('Punti da aggiungere')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Conferma/ })).not.toBeInTheDocument();
  });

  it('settings in error: "Riprova" instead of the preview and of "Conferma"; then they load', async () => {
    const settings = createFakeSettingsService({ loadResults: ['network', 'ok'] });
    renderPurchase({ settings });
    await screen.findByRole('link', { name: /Maria Rossi/ });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Impostazioni non caricate');
    expect(keypad()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Conferma/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Punti da aggiungere')).not.toBeInTheDocument();

    await press('1', '2', '5', '0');
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('button', { name: 'Conferma +12' })).toBeEnabled();
    expect(amount()).toHaveTextContent('12,50 €');
  });
});

describe('PurchasePage: common states', () => {
  it('while the customer loads: the loading state', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    customers.holdNext('get');
    renderPurchase({ customers });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Registra spesa' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Caricamento…')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tastierino numerico' })).not.toBeInTheDocument();
  });

  it.each([
    ['a customer that does not exist', `/clienti/${MISSING_ID}/spesa`, true],
    ['an id that is not a uuid (never looked up)', '/clienti/abc/spesa', false],
  ])('%s: "Cliente non trovato" with a link to the home', async (_, path, lookedUp) => {
    const { customers } = renderPurchase({ path });
    expect(await screen.findByText('Cliente non trovato')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna all’inizio' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('group', { name: 'Tastierino numerico' })).not.toBeInTheDocument();
    expect(customers.service.get.mock.calls.length > 0).toBe(lookedUp);
  });

  it('a load error: the message and "Riprova"', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    customers.failNext('get', 'network');
    renderPurchase({ customers });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cliente non caricato');
    expect(alert).toHaveTextContent('Controlla la connessione e riprova.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
  });

  it('a server fault while loading: its own message', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    customers.failNext('get', new ServerFaultError('unavailable'));
    renderPurchase({ customers });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Servizio momentaneamente non disponibile: riprova tra poco.',
    );
  });

  it('an erased customer: no purchase, a link to the customer page', async () => {
    renderPurchase({ path: `/clienti/${ERASED.id}/spesa` });
    expect(
      await screen.findByText('Cliente cancellato: non si registrano spese né premi.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna alla scheda' })).toHaveAttribute(
      'href',
      `/clienti/${ERASED.id}`,
    );
    expect(screen.queryByRole('group', { name: 'Tastierino numerico' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Conferma/ })).not.toBeInTheDocument();
    expect(screen.queryByText('cancellato-7f3a')).not.toBeInTheDocument();
  });

  it('not_operator while loading the customer: back to /accedi', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    customers.failNext('get', 'not_operator');
    const held = customers.holdNext('get');
    const auth = signedInFake();
    const { router } = renderPurchase({ customers, auth });
    await screen.findByRole('heading', { level: 1, name: 'Registra spesa' });
    auth.removeProfile();
    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
  });

  it('forbidden on "Conferma": back to /accedi', async () => {
    const auth = signedInFake();
    const { router, ledger } = renderPurchase({ auth });
    await ready();
    await press('1', '2', '5', '0');
    ledger.failNext('recordPurchase', 'forbidden');
    auth.removeProfile();
    await userEvent.click(screen.getByRole('button', { name: 'Conferma +12' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
    expect(ledger.movements()).toHaveLength(0);
  });
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('PurchasePage: Spesa registrata', () => {
  let vibrate: ReturnType<typeof vi.fn<(pattern: VibratePattern) => boolean>>;

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  /** Types 12,50 € and confirms with fake timers at 10:42 in Rome, a phone that vibrates. */
  async function confirmPurchase() {
    await ready();
    await press('1', '2', '5', '0');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T09:42:00.000Z'));
    vibrate = vi.fn<(pattern: VibratePattern) => boolean>(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Conferma +12' }));
    await advance(0);
  }

  it('the texts of the wireframe with the server’s points and balance, the vibration, back to / after 10 s (criterion 3)', async () => {
    const { router, ledger } = renderPurchase();
    await ready();
    // Another operator records 5 points in the meantime: the page still shows 120 + 12.
    await ledger.service.recordPurchase({
      operationId: '00000000-0000-4000-e000-0000000000aa',
      customerId: MARIA.id,
      amountCents: 500,
    });
    await confirmPurchase();

    const title = screen.getByRole('heading', { level: 1, name: 'Spesa registrata' });
    expect(title).toHaveFocus();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tastierino numerico' })).not.toBeInTheDocument();
    expect(screen.getByText('+12 punti a Maria Rossi')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('137 punti');
    expect(screen.getByText('12,50 € · oggi 10:42 · Giulia Prova')).toBeInTheDocument();
    expect(vibrate).toHaveBeenCalledWith(200);
    expect(screen.getByRole('timer')).toHaveTextContent(
      'Torno alla lettura delle card tra 10 secondi',
    );
    expect(screen.getByRole('link', { name: 'Apri la scheda di Maria' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}`,
    );

    await advance(9000);
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/spesa`);
    await advance(1000);
    expect(router.state.location.pathname).toBe('/');
    expect(ledger.movements()).toHaveLength(2);
  });

  it('a purchase worth one point: "+1 punto a Maria Rossi"', async () => {
    renderPurchase();
    await ready();
    await press('1', '9', '9');
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Conferma +1' }));
    await advance(0);
    expect(screen.getByText('+1 punto a Maria Rossi')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('121 punti');
  });

  it('the system back from the confirmation does not go back to the keypad', async () => {
    const { router } = renderPurchase({ path: '/' });
    await screen.findByRole('heading', { level: 1 });
    await act(async () => {
      await router.navigate(`/clienti/${MARIA.id}`);
    });
    await act(async () => {
      await router.navigate(`/clienti/${MARIA.id}/spesa`);
    });
    await confirmPurchase();
    expect(screen.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeInTheDocument();

    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`);
    expect(screen.queryByRole('group', { name: 'Tastierino numerico' })).not.toBeInTheDocument();
    // The countdown of the confirmation left with it.
    await advance(15_000);
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`);
  });

  it('"Leggi un’altra card" goes to / at once', async () => {
    const { router } = renderPurchase();
    await confirmPurchase();
    fireEvent.click(screen.getByRole('link', { name: 'Leggi un’altra card' }));
    await advance(0);
    expect(router.state.location.pathname).toBe('/');
  });

  it('"Apri la scheda di Maria" opens the customer page', async () => {
    const { router } = renderPurchase();
    await confirmPurchase();
    fireEvent.click(screen.getByRole('link', { name: 'Apri la scheda di Maria' }));
    await advance(0);
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`);
  });
});

/** Types 12,50 € and confirms with fake timers: "Spesa registrata" with 132 points. */
async function confirmTwelveFifty() {
  await ready();
  await press('1', '2', '5', '0');
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Conferma +12' }));
  await advance(0);
  expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('132 punti');
}

describe('PurchasePage: Annulla la spesa', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancelled at once: "Spesa annullata", the balance back to 120 from the server, no return (criterion 8)', async () => {
    const { router, ledger } = renderPurchase();
    // A waiter cancelling their own purchase within the window.
    ledger.setOperator({ ...fakeOperator, role: 'operator' });
    await confirmTwelveFifty();
    await advance(4000);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 6 s' }));
    await advance(0);

    expect(screen.getByRole('heading', { level: 1, name: 'Spesa annullata' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('120 punti');
    const [purchase, correction] = ledger.movements();
    expect(ledger.movements()).toHaveLength(2);
    expect(correction).toMatchObject({
      kind: 'correction',
      points: -12,
      correctsMovementId: purchase?.id,
    });
    // A new operation id, not the purchase's.
    expect(correction?.operationId).not.toBe(purchase?.operationId);
    expect(ledger.customers.customers().find((c) => c.id === MARIA.id)?.balance).toBe(120);

    await advance(30_000);
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/spesa`);
    expect(screen.getByRole('link', { name: 'Leggi un’altra card' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri la scheda di Maria' })).toBeInTheDocument();
  });

  it('too late for the server (EC003 from the fake): the text, then back to / after 3 s', async () => {
    const { router, ledger } = renderPurchase();
    // A waiter: the server checks the 10-second window (an administrator has none).
    ledger.setOperator({ ...fakeOperator, role: 'operator' });
    await confirmTwelveFifty();
    // The request reaches the server 11 s after the purchase (a slow network).
    ledger.advanceClock(11_000);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 10 s' }));
    await advance(0);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tempo scaduto: per annullare ora serve un amministratore.',
    );
    expect(screen.queryByRole('button', { name: /^Annulla la spesa/ })).not.toBeInTheDocument();
    expect(ledger.movements()).toHaveLength(1);
    expect(screen.getByRole('timer')).toHaveTextContent(
      'Torno alla lettura delle card tra 3 secondi',
    );
    await advance(3000);
    expect(router.state.location.pathname).toBe('/');
  });

  it('answer lost: "Riprova" resends the same id and the fake holds a single cancellation', async () => {
    const { router, ledger } = renderPurchase();
    await confirmTwelveFifty();
    ledger.failNext('cancelMovement', 'lost');
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 10 s' }));
    await advance(0);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Annullamento non riuscito: controlla la connessione e riprova.',
    );
    await advance(20_000);
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/spesa`);

    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await advance(0);

    expect(screen.getByRole('heading', { level: 1, name: 'Spesa annullata' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('120 punti');
    const cancels = ledger.calls.filter((call) => call.method === 'cancelMovement');
    expect(cancels).toHaveLength(2);
    expect(cancels[1]?.args).toEqual(cancels[0]?.args);
    expect(ledger.movements().filter((m) => m.kind === 'correction')).toHaveLength(1);
  });

  it('network down: nothing written, "Riprova" once the network is back', async () => {
    const { ledger } = renderPurchase();
    await confirmTwelveFifty();
    ledger.setNetworkDown(true);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 10 s' }));
    await advance(0);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(ledger.movements()).toHaveLength(1);

    ledger.setNetworkDown(false);
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await advance(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Spesa annullata' })).toBeInTheDocument();
    expect(ledger.movements()).toHaveLength(2);
  });

  it('forbidden on "Annulla": back to /accedi', async () => {
    const auth = signedInFake();
    const { router, ledger } = renderPurchase({ auth });
    await confirmTwelveFifty();
    vi.useRealTimers();
    ledger.failNext('cancelMovement', 'forbidden');
    auth.removeProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 10 s' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(ledger.movements()).toHaveLength(1);
  });

  it('the button is gone after 10 s, with the page back on /', async () => {
    const { router } = renderPurchase();
    await confirmTwelveFifty();
    await advance(10_000);
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByRole('button', { name: /^Annulla la spesa/ })).not.toBeInTheDocument();
  });
});

const OFFLINE_TEXT =
  'Il telefono non è connesso a internet. L’importo resta qui: riprova appena torna la rete. La spesa non verrà registrata due volte.';
const SERVER_TEXT =
  'Il server non ha risposto correttamente. Riprova: la spesa non verrà registrata due volte.';

/** The operation ids `recordPurchase` received, in order. */
function purchaseIds(ledger: ReturnType<typeof createFakeLedgerService>): string[] {
  return ledger.service.recordPurchase.mock.calls.map(([input]) => input.operationId);
}

/** Types 12,50 € and taps "Conferma +12" with fake timers; the answer is the fake's to give. */
async function confirmWithFakeTimers() {
  await ready();
  await press('1', '2', '5', '0');
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Conferma +12' }));
  await advance(0);
}

function failure() {
  return screen.getByRole('alert');
}

describe('PurchasePage: Spesa non salvata', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('network down: the alert of the wireframe instead of the keypad, amount and preview still there (criterion 4)', async () => {
    const { ledger } = renderPurchase();
    ledger.setNetworkDown(true);
    await confirmWithFakeTimers();

    expect(within(failure()).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Spesa non salvata',
    );
    expect(failure()).toHaveTextContent(OFFLINE_TEXT);
    expect(screen.queryByRole('group', { name: 'Tastierino numerico' })).not.toBeInTheDocument();
    expect(amount()).toHaveTextContent('12,50 €');
    expect(screen.getByText('+12')).toBeInTheDocument();
    expect(
      screen.getByText('1 punto ogni 1,00 €, per difetto · nuovo saldo 132 punti'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Annulla' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: /^Conferma/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Riscatta premio' })).not.toBeInTheDocument();
    expect(ledger.movements()).toHaveLength(0);
    // Nothing is resent on its own.
    await advance(60_000);
    expect(purchaseIds(ledger)).toHaveLength(1);

    ledger.setNetworkDown(false);
    fireEvent.click(screen.getByRole('button', { name: 'Riprova +12' }));
    await advance(0);

    expect(screen.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeInTheDocument();
    const ids = purchaseIds(ledger);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(ledger.movements()).toHaveLength(1);
  });

  it('answer lost after the write: "Riprova" resends the same id, a single movement (criterion 4)', async () => {
    const { ledger } = renderPurchase();
    ledger.failNext('recordPurchase', 'lost');
    await confirmWithFakeTimers();
    expect(failure()).toHaveTextContent(OFFLINE_TEXT);
    expect(ledger.movements()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Riprova +12' }));
    await advance(0);

    expect(screen.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('132 punti');
    const ids = purchaseIds(ledger);
    expect(ids).toEqual([ids[0], ids[0]]);
    expect(ledger.movements()).toHaveLength(1);
  });

  it('a double tap on "Riprova" is one call, and the alert stays while it is sent', async () => {
    const { ledger } = renderPurchase();
    ledger.setNetworkDown(true);
    await confirmWithFakeTimers();
    ledger.setNetworkDown(false);
    const held = ledger.holdNext('recordPurchase');
    const retry = screen.getByRole('button', { name: 'Riprova +12' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await advance(0);

    expect(failure()).toHaveTextContent('Spesa non salvata');
    expect(screen.queryByRole('group', { name: 'Tastierino numerico' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Riprova \+12/ })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await act(async () => {
      held.release();
    });
    await advance(0);

    expect(screen.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeInTheDocument();
    expect(purchaseIds(ledger)).toHaveLength(2);
    expect(ledger.movements()).toHaveLength(1);
  });

  it('the amount is locked while the answer is pending: "Riprova" resends the confirmed amount (criterion 4)', async () => {
    const { ledger } = renderPurchase();
    ledger.failNext('recordPurchase', 'lost');
    const held = ledger.holdNext('recordPurchase');
    await confirmWithFakeTimers();
    // The answer is slow: the keys pressed meanwhile change nothing.
    fireEvent.click(within(keypad()).getByRole('button', { name: '0' }));
    await advance(0);
    expect(amount()).toHaveTextContent('12,50 €');
    await act(async () => {
      held.release();
    });
    await advance(0);
    expect(failure()).toHaveTextContent(OFFLINE_TEXT);
    expect(amount()).toHaveTextContent('12,50 €');

    fireEvent.click(screen.getByRole('button', { name: 'Riprova +12' }));
    await advance(0);

    expect(screen.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeInTheDocument();
    expect(screen.getByText('+12 punti a Maria Rossi')).toBeInTheDocument();
    const amounts = ledger.service.recordPurchase.mock.calls.map(([input]) => input.amountCents);
    expect(amounts).toEqual([1250, 1250]);
    expect(ledger.movements()).toHaveLength(1);
  });

  it('no answer within 8 s: the same alert, then "Riprova" with the same id', async () => {
    const { ledger } = renderPurchase();
    ledger.failNext('recordPurchase', 'timeout');
    await confirmWithFakeTimers();
    await advance(7999);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conferma \+12/ })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await advance(1);
    expect(failure()).toHaveTextContent(OFFLINE_TEXT);
    expect(ledger.movements()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Riprova +12' }));
    await advance(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeInTheDocument();
    const ids = purchaseIds(ledger);
    expect(ids[1]).toBe(ids[0]);
    expect(ledger.movements()).toHaveLength(1);
  });

  it.each([
    ['unknown', 'unknown' as const],
    ['a server fault (503)', new ServerFaultError('unavailable')],
  ])('%s: the server text, "Riprova" with the same id', async (_label, error) => {
    const { ledger } = renderPurchase();
    ledger.failNext('recordPurchase', error);
    await confirmWithFakeTimers();

    expect(within(failure()).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Spesa non salvata',
    );
    expect(failure()).toHaveTextContent(SERVER_TEXT);
    expect(screen.queryByRole('group', { name: 'Tastierino numerico' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Riprova +12' }));
    await advance(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeInTheDocument();
    const ids = purchaseIds(ledger);
    expect(ids[1]).toBe(ids[0]);
  });

  it('"Annulla" goes to the home and discards the id: the next purchase has a new one', async () => {
    const { router, ledger } = renderPurchase();
    ledger.setNetworkDown(true);
    await confirmWithFakeTimers();
    ledger.setNetworkDown(false);
    fireEvent.click(screen.getByRole('link', { name: 'Annulla' }));
    await advance(0);
    expect(router.state.location.pathname).toBe('/');
    expect(ledger.movements()).toHaveLength(0);

    vi.useRealTimers();
    await act(async () => {
      await router.navigate(`/clienti/${MARIA.id}/spesa`);
    });
    await ready();
    await press('1', '2', '5', '0');
    await userEvent.click(screen.getByRole('button', { name: 'Conferma +12' }));
    await screen.findByRole('heading', { level: 1, name: 'Spesa registrata' });
    const ids = purchaseIds(ledger);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it.each(['invalid', 'conflict'] as const)(
    '%s: "Spesa non registrata: dati non validi. Ricomincia.", amount cleared, a new id after',
    async (kind) => {
      const { ledger } = renderPurchase();
      ledger.failNext('recordPurchase', kind);
      await confirmWithFakeTimers();

      expect(failure()).toHaveTextContent('Spesa non registrata: dati non validi. Ricomincia.');
      expect(amount()).toHaveTextContent('0,00 €');
      expect(keypad()).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Riprova/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Conferma +0' })).toBeDisabled();

      vi.useRealTimers();
      await press('1', '2', '5', '0');
      await userEvent.click(screen.getByRole('button', { name: 'Conferma +12' }));
      await screen.findByRole('heading', { level: 1, name: 'Spesa registrata' });
      const ids = purchaseIds(ledger);
      expect(ids).toHaveLength(2);
      expect(ids[1]).not.toBe(ids[0]);
      expect(ledger.movements()).toHaveLength(1);
    },
  );

  it('a definitive refusal after a "Riprova": back to the keypad, a new id after', async () => {
    const { ledger } = renderPurchase();
    ledger.setNetworkDown(true);
    await confirmWithFakeTimers();
    ledger.setNetworkDown(false);
    ledger.failNext('recordPurchase', 'conflict');
    fireEvent.click(screen.getByRole('button', { name: 'Riprova +12' }));
    await advance(0);

    expect(failure()).toHaveTextContent('Spesa non registrata: dati non validi. Ricomincia.');
    expect(keypad()).toBeInTheDocument();

    vi.useRealTimers();
    await press('5', '0', '0');
    await userEvent.click(screen.getByRole('button', { name: 'Conferma +5' }));
    await screen.findByRole('heading', { level: 1, name: 'Spesa registrata' });
    const ids = purchaseIds(ledger);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('customer-unavailable: "Cliente non trovato" with a link to the home', async () => {
    const { ledger } = renderPurchase();
    ledger.failNext('recordPurchase', 'customer-unavailable');
    await confirmWithFakeTimers();

    expect(screen.getByRole('heading', { level: 2, name: 'Cliente non trovato' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Torna all’inizio' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('group', { name: 'Tastierino numerico' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Riprova|^Conferma/ })).not.toBeInTheDocument();
  });
});
