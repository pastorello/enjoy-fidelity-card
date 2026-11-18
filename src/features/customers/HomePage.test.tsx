import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { ServerFaultError } from '../../lib/serverFault';

/**
 * The field is "Oppure cerca per nome o telefono" under the full card panel (wireframe Cerca cliente)
 * and "Cerca per nome o telefono" under the compact one (wireframe Ricerca senza risultati).
 */
const SEARCH_LABEL = /^(Oppure cerca|Cerca) per nome o telefono$/;

function customersFake() {
  return createFakeCustomerService({
    customers: [
      fakeCustomer({ name: 'Maria Rossi', phone: '+393330004521', balance: 120 }),
      fakeCustomer({ name: 'Rosa Bianchi', phone: null, balance: 0 }),
    ],
  });
}

async function renderHome(path = '/', customers = customersFake()) {
  const rendered = renderApp(path, signedInFake(), createFakeSettingsService(), customers);
  const field = await screen.findByRole('searchbox', { name: SEARCH_LABEL });
  return { ...rendered, field };
}

function searchCalls(customers: ReturnType<typeof createFakeCustomerService>) {
  return customers.calls.filter((call) => call.method === 'search');
}

/** Types `text` one character at a time, as a person would. */
function typeSlowly(field: HTMLElement, text: string) {
  for (let end = 1; end <= text.length; end += 1) {
    fireEvent.change(field, { target: { value: text.slice(0, end) } });
  }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function resultList() {
  return screen.getByRole('list', { name: 'Risultati della ricerca' });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HomePage: Cerca cliente', () => {
  it('shows the logo, the account button, the search field and "Nuovo cliente"', async () => {
    const { field } = await renderHome();
    expect(screen.getByRole('heading', { level: 1, name: 'Enjoy Card' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Account e impostazioni/ })).toBeInTheDocument();
    expect(field).toHaveAttribute('placeholder', 'Es. Rossi o 4521');
    expect(screen.getByRole('link', { name: 'Nuovo cliente' })).toHaveAttribute(
      'href',
      '/clienti/nuovo',
    );
  });

  it('searches once, 250 ms after the last key', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/', customers);
    vi.useFakeTimers();
    typeSlowly(field, 'rossi');
    await advance(249);
    expect(searchCalls(customers)).toEqual([]);
    await advance(1);
    expect(searchCalls(customers)).toEqual([{ method: 'search', args: ['rossi'] }]);
    expect(within(resultList()).getByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
    // The masked phone in the row is never a link to call or text the customer.
    expect(within(resultList()).getByRole('link', { name: /Maria Rossi/ })).toHaveTextContent(
      '••• 4521',
    );
    expect(document.querySelector('[href^="tel:"], [href^="sms:"]')).toBeNull();
    await advance(1000);
    expect(searchCalls(customers)).toHaveLength(1);
  });

  it('does not search a text that is too short', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/', customers);
    vi.useFakeTimers();
    fireEvent.change(field, { target: { value: 'r' } });
    await advance(1000);
    fireEvent.change(field, { target: { value: '45' } });
    await advance(1000);
    fireEvent.change(field, { target: { value: '   ' } });
    await advance(1000);
    expect(searchCalls(customers)).toEqual([]);
    expect(screen.queryByRole('list', { name: 'Risultati della ricerca' })).not.toBeInTheDocument();
  });

  it('ignores an older answer that arrives after the newer one', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/', customers);
    vi.useFakeTimers();
    const first = customers.holdNext('search');
    fireEvent.change(field, { target: { value: 'ros' } });
    await advance(250);
    fireEvent.change(field, { target: { value: 'rossi' } });
    await advance(250);
    expect(within(resultList()).getByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();

    await act(async () => {
      first.release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(searchCalls(customers).map((call) => call.args)).toEqual([['ros'], ['rossi']]);
    expect(screen.queryByText('Rosa Bianchi')).not.toBeInTheDocument();
    expect(within(resultList()).getAllByRole('link')).toHaveLength(1);
  });

  it('shows "Ricerca…" while the answer is on its way', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/', customers);
    vi.useFakeTimers();
    const held = customers.holdNext('search');
    fireEvent.change(field, { target: { value: 'rossi' } });
    await advance(250);
    expect(screen.getByRole('status')).toHaveTextContent('Ricerca…');
    await act(async () => {
      held.release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText('Ricerca…')).not.toBeInTheDocument();
    expect(within(resultList()).getByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
  });

  it('shows name, masked phone or "Senza telefono", and the balance in each row', async () => {
    const customers = customersFake();
    const [maria, rosa] = customers.customers();
    const { field } = await renderHome('/', customers);
    vi.useFakeTimers();
    fireEvent.change(field, { target: { value: 'ros' } });
    await advance(250);

    const rows = within(resultList()).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Maria Rossi');
    expect(rows[0]).toHaveTextContent('••• 4521');
    expect(rows[0]).toHaveTextContent('120 punti');
    expect(rows[0]).toHaveAttribute('href', `/clienti/${maria?.id}`);
    expect(rows[1]).toHaveTextContent('Rosa Bianchi');
    expect(rows[1]).toHaveTextContent('Senza telefono');
    expect(rows[1]).toHaveTextContent('0 punti');
    expect(rows[1]).toHaveAttribute('href', `/clienti/${rosa?.id}`);
  });

  it('shows 20 rows and a final hint when there are more', async () => {
    const customers = createFakeCustomerService({
      customers: Array.from({ length: 25 }, (_, index) =>
        fakeCustomer({ name: `Cliente Prova ${String(index + 1).padStart(2, '0')}` }),
      ),
    });
    const { field } = await renderHome('/', customers);
    vi.useFakeTimers();
    fireEvent.change(field, { target: { value: 'prova' } });
    await advance(250);

    const rows = within(resultList()).getAllByRole('link');
    expect(rows).toHaveLength(20);
    expect(rows[19]).toHaveTextContent('Cliente Prova 20');
    expect(screen.queryByText('Cliente Prova 21')).not.toBeInTheDocument();
    expect(screen.getByText('Mostro i primi 20: scrivi qualcosa in più')).toBeInTheDocument();
  });

  it('shows no hint with 20 results or fewer', async () => {
    const customers = createFakeCustomerService({
      customers: Array.from({ length: 20 }, (_, index) =>
        fakeCustomer({ name: `Cliente Prova ${String(index + 1).padStart(2, '0')}` }),
      ),
    });
    const { field } = await renderHome('/', customers);
    vi.useFakeTimers();
    fireEvent.change(field, { target: { value: 'prova' } });
    await advance(250);
    expect(within(resultList()).getAllByRole('link')).toHaveLength(20);
    expect(screen.queryByText(/Mostro i primi 20/)).not.toBeInTheDocument();
  });

  it('keeps the text in the URL with replace, and "Cancella la ricerca" clears it', async () => {
    const { router, field } = await renderHome();
    await userEvent.type(field, 'rossi mari');
    await waitFor(() => expect(router.state.location.search).toBe('?q=rossi+mari'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancella la ricerca' }));
    expect(field).toHaveValue('');
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.queryByRole('list', { name: 'Risultati della ricerca' })).not.toBeInTheDocument();
  });

  it('opens with the search of /?q=', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/?q=rossi', customers);
    expect(field).toHaveValue('rossi');
    expect(await screen.findByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
    expect(searchCalls(customers)).toEqual([{ method: 'search', args: ['rossi'] }]);
  });

  it('finds the search again with "Indietro" from the customer page', async () => {
    const customers = customersFake();
    const [maria] = customers.customers();
    const { router } = await renderHome('/?q=rossi', customers);
    await userEvent.click(await screen.findByRole('link', { name: /Maria Rossi/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${maria?.id}`));

    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.search).toBe('?q=rossi');
    expect(await screen.findByRole('searchbox', { name: SEARCH_LABEL })).toHaveValue('rossi');
    expect(await screen.findByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
  });

  it('no results by name: says so and turns the button into "Nuovo cliente «<testo>»"', async () => {
    const { field } = await renderHome();
    await userEvent.type(field, '  verdi   luca ');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Nessun cliente trovato' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Controlla come è scritto, o cerca con le ultime 4 cifre del telefono.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Risultati della ricerca' })).not.toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /^Nuovo cliente/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Nuovo cliente «verdi luca»');
    expect(links[0]).toHaveAttribute('href', '/clienti/nuovo?nome=verdi+luca');
  });

  it('"Nuovo cliente «<testo>»" opens Nuovo cliente with the name in the URL', async () => {
    const { router, field } = await renderHome();
    await userEvent.type(field, "D'Angelo & figli");
    await userEvent.click(await screen.findByRole('link', { name: /^Nuovo cliente «/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/clienti/nuovo'));
    expect(new URLSearchParams(router.state.location.search).get('nome')).toBe("D'Angelo & figli");
  });

  it('no results by phone: the button stays "Nuovo cliente" with nothing prefilled', async () => {
    const { field } = await renderHome();
    await userEvent.type(field, '9999');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Nessun cliente trovato' }),
    ).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /^Nuovo cliente/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Nuovo cliente');
    expect(links[0]).toHaveAttribute('href', '/clienti/nuovo');
  });

  it('the button goes back to "Nuovo cliente" once the search finds someone', async () => {
    const { field } = await renderHome();
    await userEvent.type(field, 'verdi');
    expect(await screen.findByRole('link', { name: 'Nuovo cliente «verdi»' })).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, 'rossi');
    expect(await screen.findByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Nuovo cliente/ })).toHaveAccessibleName(
      'Nuovo cliente',
    );
  });

  it('a failed search shows "Ricerca non riuscita", and "Riprova" searches again', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/', customers);
    customers.failNext('search', 'network');
    await userEvent.type(field, 'rossi');

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: 'Ricerca non riuscita' }),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent('Controlla la connessione e riprova.');
    expect(screen.queryByRole('list', { name: 'Risultati della ricerca' })).not.toBeInTheDocument();
    expect(searchCalls(customers)).toHaveLength(1);

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(searchCalls(customers).map((call) => call.args)).toEqual([['rossi'], ['rossi']]);
  });

  it('keeps the focus in the search outcome after "Riprova", while searching and after', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/', customers);
    customers.failNext('search', 'network');
    await userEvent.type(field, 'rossi');
    const alert = await screen.findByRole('alert');
    const held = customers.holdNext('search');

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(screen.getByText('Ricerca…')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    const list = await screen.findByRole('list', { name: 'Risultati della ricerca' });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.contains(list)).toBe(true);
  });

  it('a server fault is worded apart from a network error', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/', customers);
    customers.failNext('search', new ServerFaultError('misconfigured'));
    await userEvent.type(field, 'rossi');

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: 'Ricerca non riuscita' }),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent('Servizio non configurato: chiedi a un amministratore.');
  });

  it('not_operator: back to /accedi with "Account non abilitato"', async () => {
    const auth = signedInFake();
    const customers = customersFake();
    const { router } = renderApp('/', auth, createFakeSettingsService(), customers);
    const field = await screen.findByRole('searchbox', { name: SEARCH_LABEL });
    auth.removeProfile();
    customers.failNext('search', 'not_operator');
    await userEvent.type(field, 'rossi');

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
  });
});

/** Customers served today, most recent first (times in Europe/Rome: UTC+1 in November). */
function servedFake() {
  const customers = createFakeCustomerService({
    customers: [
      fakeCustomer({
        name: 'Antonio Esposito',
        phone: '+393330000388',
        balance: 45,
        lastServedAt: '2026-11-18T09:15:00Z',
      }),
      fakeCustomer({
        name: 'Lucia De Meo',
        phone: null,
        balance: 310,
        lastServedAt: '2026-11-18T08:58:00Z',
      }),
    ],
  });
  customers.setServedToday(customers.customers().map((customer) => customer.id));
  return customers;
}

function servedCalls(customers: ReturnType<typeof createFakeCustomerService>) {
  return customers.calls.filter((call) => call.method === 'servedToday');
}

function servedSection() {
  return screen.queryByRole('region', { name: 'SERVITI OGGI' });
}

function becomeVisible() {
  act(() => {
    fireEvent(document, new Event('visibilitychange'));
  });
}

describe('HomePage: SERVITI OGGI', () => {
  it('lists the customers served today: name, phone or "Senza telefono", time, balance', async () => {
    const customers = servedFake();
    const [antonio, lucia] = customers.customers();
    await renderHome('/', customers);

    const section = await screen.findByRole('region', { name: 'SERVITI OGGI' });
    expect(within(section).getByRole('heading', { level: 2, name: 'SERVITI OGGI' })).toBeVisible();
    const rows = within(section).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Antonio Esposito');
    expect(rows[0]).toHaveTextContent('••• 0388 · 10:15');
    expect(rows[0]).toHaveTextContent('45 punti');
    expect(rows[0]).toHaveAttribute('href', `/clienti/${antonio?.id}`);
    expect(rows[1]).toHaveTextContent('Lucia De Meo');
    expect(rows[1]).toHaveTextContent('Senza telefono · 09:58');
    expect(rows[1]).toHaveTextContent('310 punti');
    expect(rows[1]).toHaveAttribute('href', `/clienti/${lucia?.id}`);
    // The phone never becomes a link to call or text the customer.
    expect(document.querySelector('[href^="tel:"], [href^="sms:"]')).toBeNull();
    expect(servedCalls(customers)).toHaveLength(1);
  });

  it('has no section when nobody was served today', async () => {
    const customers = customersFake();
    await renderHome('/', customers);
    await waitFor(() => expect(servedCalls(customers)).toHaveLength(1));
    // Let the answer arrive before checking that nothing appeared.
    await act(async () => {
      await Promise.resolve();
    });
    expect(servedSection()).not.toBeInTheDocument();
    expect(screen.queryByText('SERVITI OGGI')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows nothing while the list is loading', async () => {
    const customers = servedFake();
    const held = customers.holdNext('servedToday');
    await renderHome('/', customers);
    expect(servedSection()).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    expect(await screen.findByRole('region', { name: 'SERVITI OGGI' })).toBeInTheDocument();
  });

  it('a failed load shows a compact row, and "Riprova" loads again', async () => {
    const customers = servedFake();
    customers.failNext('servedToday', 'network');
    await renderHome('/', customers);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Non riesco a caricare i clienti di oggi');
    expect(screen.queryByRole('link', { name: /Antonio Esposito/ })).not.toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    const section = await screen.findByRole('region', { name: 'SERVITI OGGI' });
    expect(within(section).getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(servedCalls(customers)).toHaveLength(2);
  });

  it('after "Riprova" the focus goes to SERVITI OGGI and stays there once the list arrives', async () => {
    const customers = servedFake();
    customers.failNext('servedToday', 'network');
    await renderHome('/', customers);
    const alert = await screen.findByRole('alert');
    const held = customers.holdNext('servedToday');

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    const heading = screen.getByRole('heading', { level: 2, name: 'SERVITI OGGI' });
    expect(heading).toHaveFocus();
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    const section = await screen.findByRole('region', { name: 'SERVITI OGGI' });
    expect(within(section).getAllByRole('link')).toHaveLength(2);
    expect(heading).toHaveFocus();
  });

  it('after "Riprova" with nobody served today, the focus goes to the search field', async () => {
    const customers = customersFake();
    customers.failNext('servedToday', 'network');
    const { field } = await renderHome('/', customers);
    const alert = await screen.findByRole('alert');

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(servedSection()).not.toBeInTheDocument());
    expect(field).toHaveFocus();
  });

  it('loads again when the page becomes visible', async () => {
    const customers = customersFake();
    await renderHome('/', customers);
    await waitFor(() => expect(servedCalls(customers)).toHaveLength(1));
    expect(servedSection()).not.toBeInTheDocument();

    const [maria] = customers.customers();
    customers.setServedToday([maria?.id ?? '']);
    becomeVisible();

    const section = await screen.findByRole('region', { name: 'SERVITI OGGI' });
    expect(within(section).getByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
    expect(servedCalls(customers)).toHaveLength(2);
  });

  it('does not load again while the page is hidden', async () => {
    const customers = customersFake();
    await renderHome('/', customers);
    await waitFor(() => expect(servedCalls(customers)).toHaveLength(1));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      becomeVisible();
      expect(servedCalls(customers)).toHaveLength(1);
    } finally {
      visibility.mockRestore();
    }
  });

  it('a failed reload on return keeps the list already shown', async () => {
    const customers = servedFake();
    await renderHome('/', customers);
    await screen.findByRole('region', { name: 'SERVITI OGGI' });

    customers.failNext('servedToday', 'network');
    becomeVisible();
    await waitFor(() => expect(servedCalls(customers)).toHaveLength(2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Antonio Esposito/ })).toBeInTheDocument();
  });

  it('ignores an older answer that arrives after a newer one', async () => {
    const customers = servedFake();
    const [antonio, lucia] = customers.customers();
    const first = customers.holdNext('servedToday');
    await renderHome('/', customers);

    customers.setServedToday([antonio?.id ?? '']);
    becomeVisible();
    const section = await screen.findByRole('region', { name: 'SERVITI OGGI' });
    expect(within(section).getAllByRole('link')).toHaveLength(1);

    // The fake computes a held answer when it is released: make the old answer differ from the
    // new one, so showing it would add Lucia's row.
    customers.setServedToday([antonio?.id ?? '', lucia?.id ?? '']);
    await act(async () => {
      first.release();
      await Promise.resolve();
    });
    expect(servedCalls(customers)).toHaveLength(2);
    expect(within(section).getAllByRole('link')).toHaveLength(1);
    expect(within(section).queryByRole('link', { name: /Lucia De Meo/ })).not.toBeInTheDocument();
  });

  it('is hidden while a search is shown, and back when the search is cleared', async () => {
    const customers = servedFake();
    const { field } = await renderHome('/', customers);
    await screen.findByRole('region', { name: 'SERVITI OGGI' });

    await userEvent.type(field, 'lucia');
    expect(
      await screen.findByRole('list', { name: 'Risultati della ricerca' }),
    ).toBeInTheDocument();
    expect(servedSection()).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancella la ricerca' }));
    expect(await screen.findByRole('region', { name: 'SERVITI OGGI' })).toBeInTheDocument();
  });

  it('not_operator: back to /accedi with "Account non abilitato"', async () => {
    const auth = signedInFake();
    const customers = servedFake();
    const { router } = renderApp('/', auth, createFakeSettingsService(), customers);
    await screen.findByRole('region', { name: 'SERVITI OGGI' });
    auth.removeProfile();
    customers.failNext('servedToday', 'not_operator');
    becomeVisible();

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
  });
});

/** The live region under the search, on the page from the start (TalkBack ignores late ones). */
function announcer() {
  return screen.getByTestId('search-announcer');
}

describe('HomePage: announcements', () => {
  it('says how a search ended in a live region that was already on the page', async () => {
    const { field } = await renderHome();
    const live = announcer();
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveClass('visually-hidden');
    expect(live).toBeEmptyDOMElement();

    await userEvent.type(field, 'rossi');
    await waitFor(() => expect(live).toHaveTextContent('1 cliente trovato'));
    expect(announcer()).toBe(live);

    await userEvent.clear(field);
    await userEvent.type(field, 'verdi');
    await waitFor(() => expect(live).toHaveTextContent('Nessun cliente trovato'));
    expect(announcer()).toBe(live);

    await userEvent.clear(field);
    expect(live).toBeEmptyDOMElement();
  });

  it('counts the rows, and says when there are more than shown', async () => {
    const customers = createFakeCustomerService({
      customers: [
        ...Array.from({ length: 3 }, (_, index) => fakeCustomer({ name: `Tre Prova ${index}` })),
        ...Array.from({ length: 25 }, (_, index) =>
          fakeCustomer({ name: `Molti Prova ${String(index).padStart(2, '0')}` }),
        ),
      ],
    });
    const { field } = await renderHome('/', customers);
    await userEvent.type(field, 'tre prova');
    await waitFor(() => expect(announcer()).toHaveTextContent('3 clienti trovati'));
    await userEvent.clear(field);
    await userEvent.type(field, 'molti');
    await waitFor(() =>
      expect(announcer()).toHaveTextContent('Più di 20 clienti trovati: scrivi qualcosa in più'),
    );
  });

  it('the home message is written into its status row after the row is on the page', async () => {
    const { router } = renderApp('/impostazioni', signedInFake());
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
    await act(async () => {
      await router.navigate('/', {
        replace: true,
        state: { notice: 'Dati del cliente cancellati.' },
      });
    });
    // Mounted empty first: a live region that arrives with its text is not read out.
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    await waitFor(() => expect(status).toHaveTextContent('Dati del cliente cancellati.'));
    expect(screen.getByRole('status')).toBe(status);
  });
});

describe('HomePage: status message', () => {
  const NOTICE = 'Dati del cliente cancellati.';

  it('shows the message passed in the navigation state, at the top, once', async () => {
    const { router } = renderApp('/impostazioni', signedInFake());
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });

    await act(async () => {
      await router.navigate('/', { replace: true, state: { notice: NOTICE } });
    });
    const status = await screen.findByRole('status');
    await waitFor(() => expect(status).toHaveTextContent(NOTICE));
    // At the top of the content, before the search.
    const field = screen.getByRole('searchbox', { name: SEARCH_LABEL });
    expect(status.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The history entry no longer carries it: coming back does not show it again.
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent(NOTICE);

    await userEvent.click(screen.getByRole('link', { name: /^Account e impostazioni/ }));
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it('keeps the search in the URL when it drops the message', async () => {
    const { router } = renderApp('/impostazioni', signedInFake());
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
    await act(async () => {
      await router.navigate('/?q=rossi', { state: { notice: NOTICE } });
    });
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(router.state.location.search).toBe('?q=rossi');
  });

  it('shows no message without one, or with a state of another shape', async () => {
    const { router } = renderApp('/impostazioni', signedInFake());
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
    await act(async () => {
      await router.navigate('/', { state: { notice: 42 } });
    });
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

const HOME_TITLE = 'Avvicina la card';
const HOME_TEXT =
  'Lettura attiva: appoggia la card sul retro del telefono. Una card nuova apre la registrazione del cliente.';

async function renderWithCard(path = '/', card = createTestCardReader()) {
  const rendered = renderApp(
    path,
    signedInFake(),
    createFakeSettingsService(),
    customersFake(),
    createFakeRewardsService(),
    card,
  );
  const field = await screen.findByRole('searchbox', { name: SEARCH_LABEL });
  return { ...rendered, field };
}

function cardPanel() {
  return screen.getByRole('region', { name: 'Lettura card' });
}

describe('HomePage: Lettura card', () => {
  it('shows the full panel above "Oppure cerca per nome o telefono", as in the wireframe', async () => {
    const { field } = await renderWithCard();
    expect(await within(cardPanel()).findByText(HOME_TITLE)).toBeInTheDocument();
    expect(within(cardPanel()).getByText(HOME_TEXT)).toBeInTheDocument();
    expect(field).toHaveAccessibleName('Oppure cerca per nome o telefono');
    // The panel comes before the field in the page.
    expect(
      cardPanel().compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('asks for the permission with "Attiva la lettura" above the search', async () => {
    const card = createTestCardReader({ permission: 'prompt' });
    const { field } = await renderWithCard('/', card);
    await userEvent.click(await screen.findByRole('button', { name: 'Attiva la lettura' }));
    expect(await within(cardPanel()).findByText(HOME_TITLE)).toBeInTheDocument();
    expect(field).toHaveAccessibleName('Oppure cerca per nome o telefono');
  });

  it('shows the compact line while a search is shown, and the full panel once it is cleared', async () => {
    const { field } = await renderWithCard();
    await within(cardPanel()).findByText(HOME_TITLE);

    await userEvent.type(field, 'rossi');
    expect(
      await screen.findByRole('list', { name: 'Risultati della ricerca' }),
    ).toBeInTheDocument();
    expect(cardPanel()).toHaveTextContent('Lettura attiva: puoi anche avvicinare la card');
    expect(within(cardPanel()).queryByText(HOME_TITLE)).not.toBeInTheDocument();
    expect(field).toHaveAccessibleName('Cerca per nome o telefono');

    await userEvent.click(screen.getByRole('button', { name: 'Cancella la ricerca' }));
    expect(await within(cardPanel()).findByText(HOME_TITLE)).toBeInTheDocument();
    expect(field).toHaveAccessibleName('Oppure cerca per nome o telefono');
  });

  it('a card read is handed to cards: an unknown card opens Nuovo cliente with it', async () => {
    const card = createTestCardReader();
    const { router } = await renderWithCard('/', card);
    await within(cardPanel()).findByText(HOME_TITLE);

    act(() => {
      card.nfc.read('04:a1:b2:c3:d4:e5:f6');
    });
    expect(card.vibrate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(router.state.location.pathname).toBe('/clienti/nuovo'));
    expect(router.state.location.search).toBe('?card=04A1B2C3D4E5F6');
  });
});
