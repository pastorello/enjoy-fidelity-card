import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
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
