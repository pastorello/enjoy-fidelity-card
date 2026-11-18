import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { createFakeSettingsService } from '../../test/fakeSettingsService';

const SEARCH_LABEL = 'Cerca per nome o telefono';

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
});
