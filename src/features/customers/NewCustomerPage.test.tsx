import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const NAME = 'Nome e cognome';
const NETWORK_TEXT = 'Cliente non salvato: controlla la connessione e riprova.';

async function renderNewCustomer(
  path = '/clienti/nuovo',
  customers = createFakeCustomerService(),
  auth = signedInFake(),
) {
  const rendered = renderApp(path, auth, createFakeSettingsService(), customers);
  await screen.findByRole('textbox', { name: NAME });
  return { ...rendered, customers };
}

/** Types a valid form: the name, and the consent ticked. */
async function fillValid(name = 'Maria Rossi') {
  const field = screen.getByRole('textbox', { name: NAME });
  await userEvent.clear(field);
  await userEvent.type(field, name);
  const consent = screen.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ });
  if (consent instanceof HTMLInputElement && !consent.checked) await userEvent.click(consent);
}

type Fake = ReturnType<typeof createFakeCustomerService>;

/** The `operationId` of every `create` call, in order. */
function operationIds(customers: Fake): string[] {
  return customers.service.create.mock.calls.map(([input]) => input.operationId);
}

describe('NewCustomerPage', () => {
  it('opens at /clienti/nuovo with the title, "Indietro" to the home and "Salva cliente"', async () => {
    await renderNewCustomer();
    expect(screen.getByRole('heading', { level: 1, name: 'Nuovo cliente' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: 'Salva cliente' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ })).toBeVisible();
  });

  it('checks the form in the app: an invalid form calls no service', async () => {
    const { customers } = await renderNewCustomer();
    const callsBefore = customers.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));
    expect(screen.getByRole('textbox', { name: 'Nome e cognome' })).toHaveFocus();
    expect(screen.getByText('Scrivi nome e cognome.')).toBeInTheDocument();
    expect(
      screen.getByText('Serve il consenso privacy per registrare il cliente.'),
    ).toBeInTheDocument();
    expect(customers.calls.slice(callsBefore)).toEqual([]);
  });

  it('?nome= fills the name, cleaned of extra spaces and cut to 80 characters', async () => {
    await renderNewCustomer(`/clienti/nuovo?nome=${encodeURIComponent('  Maria   Rossi  ')}`);
    expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Maria Rossi');
  });

  it('?nome= longer than 80 characters is cut to 80', async () => {
    const long = `${'à'.repeat(79)}bcd`;
    await renderNewCustomer(`/clienti/nuovo?nome=${encodeURIComponent(long)}`);
    expect(screen.getByRole('textbox', { name: NAME })).toHaveValue(`${'à'.repeat(79)}b`);
  });

  it('saves and opens the new customer, replacing Nuovo cliente in the history', async () => {
    const { customers, router } = await renderNewCustomer();
    await fillValid();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Telefono (facoltativo)' }),
      '333 123 4521',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));

    const [saved] = customers.customers();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved?.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(customers.service.create).toHaveBeenCalledTimes(1);
    const [input] = customers.service.create.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      name: 'Maria Rossi',
      phone: '333 123 4521',
      email: '',
      privacyConsent: true,
      notes: '',
    });
    expect(input?.operationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is busy while saving: a double tap sends one request', async () => {
    const { customers, router } = await renderNewCustomer();
    await fillValid();
    const hold = customers.holdNext('create');
    const button = screen.getByRole('button', { name: 'Salva cliente' });
    fireEvent.click(button);
    fireEvent.click(button);
    // Enter in a field submits the form too, while the first send is still going.
    fireEvent.submit(screen.getByRole('textbox', { name: NAME }));
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(customers.service.create).toHaveBeenCalledTimes(1);

    await act(async () => hold.release());
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/clienti\/[0-9a-f-]{36}$/),
    );
    expect(customers.customers()).toHaveLength(1);
  });

  it('network error: the message and "Riprova", which resends the same operation_id', async () => {
    const { customers, router } = await renderNewCustomer();
    await fillValid();
    customers.failNext('create', 'network');
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TEXT);
    expect(screen.queryByRole('button', { name: 'Salva cliente' })).not.toBeInTheDocument();
    expect(customers.customers()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/clienti\//));
    const [first, second] = operationIds(customers);
    expect(second).toBe(first);
    expect(customers.customers()).toHaveLength(1);
  });

  it('answer lost, form changed, "Riprova": opens the customer saved by the first send', async () => {
    const { customers, router } = await renderNewCustomer();
    await fillValid('Maria Rossi');
    customers.failNext('create', 'lost');
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TEXT);

    await fillValid('Maria Bianchi');
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));

    const saved = customers.customers();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe('Maria Rossi');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved[0]?.id}`));
    const [first, second] = operationIds(customers);
    expect(second).toBe(first);
  });

  it('name already used: the error, "Apri la scheda" to that customer and how to tell them apart', async () => {
    const existing = fakeCustomer({ name: 'Maria Rossi' });
    const customers = createFakeCustomerService({ customers: [existing] });
    await renderNewCustomer('/clienti/nuovo', customers);
    await fillValid('maria rossi');
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));

    const link = await screen.findByRole('link', { name: 'Apri la scheda' });
    expect(link).toHaveAttribute('href', `/clienti/${existing.id}`);
    const name = screen.getByRole('textbox', { name: NAME });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription(
      'Esiste già un cliente con questo nome. Apri la scheda Se è un’altra persona, aggiungi un dettaglio al nome, per esempio «Maria Rossi Serapo».',
    );
    // The suggestion takes the place of the help text.
    expect(screen.queryByText(/Il nome identifica il cliente/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salva cliente' })).not.toHaveAttribute('aria-busy');
  });

  it('after a refusal the next save uses a new operation_id', async () => {
    const existing = fakeCustomer({ name: 'Maria Rossi' });
    const customers = createFakeCustomerService({ customers: [existing] });
    const { router } = await renderNewCustomer('/clienti/nuovo', customers);
    await fillValid('Maria Rossi');
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));
    await screen.findByRole('link', { name: 'Apri la scheda' });

    await fillValid('Maria Rossi Serapo');
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/clienti/nuovo'));
    const [first, second] = operationIds(customers);
    expect(second).not.toBe(first);
    expect(customers.customers().map((customer) => customer.name)).toEqual([
      'Maria Rossi',
      'Maria Rossi Serapo',
    ]);
  });

  it('shows a refusal of the server under its field and focuses it', async () => {
    const { customers } = await renderNewCustomer();
    await fillValid();
    customers.failNext('create', 'phone_invalid');
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));

    const phone = screen.getByRole('textbox', { name: 'Telefono (facoltativo)' });
    await waitFor(() =>
      expect(phone).toHaveAccessibleDescription(
        'Numero non valido: scrivi solo le cifre, con o senza prefisso.',
      ),
    );
    expect(phone).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a server fault: its message and "Riprova" with the same operation_id', async () => {
    const { customers, router } = await renderNewCustomer();
    await fillValid();
    customers.failNext('create', new ServerFaultError('unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Servizio momentaneamente non disponibile: riprova tra poco.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/clienti\//));
    const [first, second] = operationIds(customers);
    expect(second).toBe(first);
  });

  it('not_operator: back to /accedi with "Account non abilitato"', async () => {
    const auth = signedInFake();
    const customers = createFakeCustomerService();
    const { router } = await renderNewCustomer('/clienti/nuovo', customers, auth);
    await fillValid();
    auth.removeProfile();
    customers.failNext('create', 'not_operator');
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
  });

  it('needs a signed-in operator', async () => {
    renderApp('/clienti/nuovo');
    expect(await screen.findByRole('heading', { name: 'Accedi' })).toBeInTheDocument();
  });
});
