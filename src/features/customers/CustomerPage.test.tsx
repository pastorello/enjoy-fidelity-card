import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const MARIA = fakeCustomer({
  name: 'Maria Rossi',
  phone: '+393331234521',
  notes: 'Preferisce il caffè d’orzo',
  balance: 1250,
});
const ROSA = fakeCustomer({ name: 'Rosa Bianchi', phone: null, notes: null, balance: 0 });
const ERASED = fakeCustomer({
  name: 'Cliente cancellato abcdef12',
  phone: null,
  notes: null,
  anonymizedAt: '2026-11-17T12:00:00.000Z',
  balance: 120,
});

/** 80 characters, the longest name allowed: two header lines show only its start. */
const LONG_NAME =
  'Maria Giovanna Esposito De Laurentiis Serapo Formia Lungomare Caboto Ventitre 12';
const LONG = fakeCustomer({ name: LONG_NAME, phone: '+393331234521', notes: null, balance: 0 });

function customersFake() {
  return createFakeCustomerService({ customers: [MARIA, ROSA, ERASED, LONG] });
}

type Fake = ReturnType<typeof createFakeCustomerService>;

function renderCustomer(path: string, customers: Fake = customersFake(), auth = signedInFake()) {
  return { ...renderApp(path, auth, createFakeSettingsService(), customers), customers };
}

function getCalls(customers: Fake) {
  return customers.calls.filter((call) => call.method === 'get');
}

function balanceBox() {
  return screen.getByRole('region', { name: 'SALDO' });
}

describe('CustomerPage: Scheda cliente', () => {
  it('shows the name as title, "Indietro" to the home, "Modifica cliente", phone, notes and SALDO', async () => {
    renderCustomer(`/clienti/${MARIA.id}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Maria Rossi' }),
    ).toBeInTheDocument();
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/');
    expect(within(banner).getByRole('link', { name: 'Modifica cliente' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/modifica`,
    );
    const phone = screen.getByText('Tel. 333 ••• 4521');
    expect(screen.queryByText(/3331234521/)).not.toBeInTheDocument();
    // The phone only finds the customer: it is never a link to call or text them.
    expect(phone.closest('a')).toBeNull();
    expect(within(phone).queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('[href^="tel:"], [href^="sms:"]')).toBeNull();
    expect(screen.getByText('Preferisce il caffè d’orzo')).toBeInTheDocument();
    expect(balanceBox()).toHaveTextContent('SALDO');
    expect(balanceBox()).toHaveTextContent('1.250');
    expect(balanceBox()).toHaveTextContent('punti');
  });

  it('a customer without phone or notes: "Senza telefono", no notes line', async () => {
    renderCustomer(`/clienti/${ROSA.id}`);
    expect(await screen.findByText('Senza telefono')).toBeInTheDocument();
    expect(screen.queryByText(/^Tel\./)).not.toBeInTheDocument();
    expect(balanceBox()).toHaveTextContent('0');
    expect(balanceBox()).toHaveTextContent('punti');
  });

  it('shows the loading state until the customer arrives', async () => {
    const customers = customersFake();
    const held = customers.holdNext('get');
    renderCustomer(`/clienti/${MARIA.id}`, customers);
    // The page's own loading state, not the sign-in check before it.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Scheda cliente' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Caricamento…')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Modifica cliente' })).not.toBeInTheDocument();
    await act(async () => {
      held.release();
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Maria Rossi' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Caricamento…')).not.toBeInTheDocument();
  });

  it('a missing customer: "Cliente non trovato" with a link to the home', async () => {
    const missing = '00000000-0000-4000-8000-999999999999';
    const { customers } = renderCustomer(`/clienti/${missing}`);
    expect(await screen.findByRole('heading', { name: 'Cliente non trovato' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna all’inizio' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Modifica cliente' })).not.toBeInTheDocument();
    expect(getCalls(customers)).toEqual([{ method: 'get', args: [missing] }]);
  });

  it.each(['abc', '123', `${MARIA.id}x`, 'nuovo-cliente'])(
    'an id that is not a uuid (%s): "Cliente non trovato" without calling the service',
    async (id) => {
      const { customers } = renderCustomer(`/clienti/${id}`);
      expect(
        await screen.findByRole('heading', { name: 'Cliente non trovato' }),
      ).toBeInTheDocument();
      expect(getCalls(customers)).toEqual([]);
    },
  );

  it('a network error: says so and "Riprova" loads again', async () => {
    const customers = customersFake();
    customers.failNext('get', 'network');
    renderCustomer(`/clienti/${MARIA.id}`, customers);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Scheda non caricata');
    expect(alert).toHaveTextContent('Controlla la connessione e riprova.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Maria Rossi' }),
    ).toBeInTheDocument();
    expect(getCalls(customers)).toHaveLength(2);
  });

  it('after "Riprova" the focus stays on the page title, while loading and after', async () => {
    const customers = customersFake();
    customers.failNext('get', 'network');
    renderCustomer(`/clienti/${MARIA.id}`, customers);
    const alert = await screen.findByRole('alert');
    const held = customers.holdNext('get');

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(screen.getByText('Caricamento…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Scheda cliente' })).toHaveFocus();
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Maria Rossi' })).toHaveFocus();
  });

  it('a server fault is not a connection problem', async () => {
    const customers = customersFake();
    customers.failNext('get', new ServerFaultError('unavailable'));
    renderCustomer(`/clienti/${MARIA.id}`, customers);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Servizio momentaneamente non disponibile: riprova tra poco.',
    );
  });

  it('not_operator: back to /accedi', async () => {
    const customers = customersFake();
    customers.failNext('get', 'not_operator');
    const held = customers.holdNext('get');
    const auth = signedInFake();
    const { router } = renderCustomer(`/clienti/${MARIA.id}`, customers, auth);
    await screen.findByRole('heading', { level: 1, name: 'Scheda cliente' });
    auth.removeProfile();
    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
  });

  it('a customer whose data was erased: "Cliente cancellato", the date, the balance, no edit', async () => {
    renderCustomer(`/clienti/${ERASED.id}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Cliente cancellato' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Dati cancellati il 17 nov 2026')).toBeInTheDocument();
    expect(balanceBox()).toHaveTextContent('120');
    expect(screen.queryByRole('link', { name: 'Modifica cliente' })).not.toBeInTheDocument();
    // The technical name is never shown, nor the phone line.
    expect(screen.queryByText(/abcdef12/)).not.toBeInTheDocument();
    expect(screen.queryByText('Senza telefono')).not.toBeInTheDocument();
  });

  it('"Indietro" goes back to the search it came from (?q=)', async () => {
    const { router } = renderCustomer('/?q=rossi');
    await userEvent.click(await screen.findByRole('link', { name: /Maria Rossi/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    const back = await screen.findByRole('link', { name: 'Indietro' });
    expect(back).toHaveAttribute('href', '/?q=rossi');
    await userEvent.click(back);
    await waitFor(() => expect(router.state.location.search).toBe('?q=rossi'));
    expect(await screen.findByRole('searchbox', { name: 'Cerca per nome o telefono' })).toHaveValue(
      'rossi',
    );
  });

  it('opened from SERVITI OGGI or a direct link: "Indietro" goes to the plain home', async () => {
    const customers = customersFake();
    customers.setServedToday([MARIA.id]);
    const { router } = renderCustomer('/', customers);
    await userEvent.click(await screen.findByRole('link', { name: /Maria Rossi/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(await screen.findByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/');
  });
});

describe('CustomerPage: a long name', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an 80-character name cut by the header is shown in full above the phone', async () => {
    expect(LONG_NAME).toHaveLength(80);
    // jsdom has no layout: anything longer than two header lines (about 26 capitals) overflows.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(50);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return (this.textContent ?? '').length > 26 ? 125 : 50;
    });
    renderCustomer(`/clienti/${LONG.id}`);
    await screen.findByRole('heading', { level: 1, name: LONG_NAME });
    const main = screen.getByRole('main');
    expect(main.firstElementChild).toHaveTextContent(LONG_NAME);
    expect(main.firstElementChild?.nextElementSibling).toHaveTextContent('Tel. 333 ••• 4521');
  });
});

describe('CustomerPage: a one-time message of the navigation state', () => {
  it('shows it once in a status row, drops it from the history entry, keeps the rest of the state', async () => {
    const { router } = renderCustomer('/');
    await act(async () => {
      await router.navigate(`/clienti/${MARIA.id}`, {
        state: { notice: 'Card …0001 associata. Link non scritto.', backSearch: 'rossi' },
      });
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Card …0001 associata. Link non scritto.',
      ),
    );
    expect(router.state.location.state).toEqual({ backSearch: 'rossi' });
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/?q=rossi');
  });
});
