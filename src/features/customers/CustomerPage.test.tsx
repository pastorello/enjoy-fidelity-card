import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

function customersFake() {
  return createFakeCustomerService({ customers: [MARIA, ROSA, ERASED] });
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
    expect(screen.getByText('Tel. 333 ••• 4521')).toBeInTheDocument();
    expect(screen.queryByText(/3331234521/)).not.toBeInTheDocument();
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
