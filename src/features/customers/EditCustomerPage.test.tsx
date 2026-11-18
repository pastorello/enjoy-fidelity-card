import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const NAME = 'Nome e cognome';
const PHONE = 'Telefono (facoltativo)';
const NOTES = 'Note (facoltative)';
const SAVE = 'Salva modifiche';
const NETWORK_TEXT = 'Modifiche non salvate: controlla la connessione e riprova.';

const MARIA = fakeCustomer({
  name: 'Maria Rossi',
  phone: '+393331234521',
  notes: 'Preferisce il caffè d’orzo',
});
const LUCA = fakeCustomer({ name: 'Luca Bianchi', phone: '+447911123456', notes: null });
const ROSA = fakeCustomer({ name: 'Rosa Verdi', phone: null, notes: null });
const ERASED = fakeCustomer({
  name: 'Cliente cancellato abcdef12',
  anonymizedAt: '2026-11-17T12:00:00.000Z',
});

type Fake = ReturnType<typeof createFakeCustomerService>;

function customersFake() {
  return createFakeCustomerService({ customers: [MARIA, LUCA, ROSA, ERASED] });
}

function renderEdit(id: string, customers: Fake = customersFake(), auth = signedInFake()) {
  return {
    ...renderApp(`/clienti/${id}/modifica`, auth, createFakeSettingsService(), customers),
    customers,
  };
}

async function nameField() {
  return screen.findByRole('textbox', { name: NAME });
}

async function retype(label: string, text: string) {
  const field = screen.getByRole('textbox', { name: label });
  await userEvent.clear(field);
  if (text !== '') await userEvent.type(field, text);
}

function stored(customers: Fake, id: string) {
  return customers.customers().find((customer) => customer.id === id);
}

describe('EditCustomerPage: Modifica cliente', () => {
  it('opens with the title, "Indietro" to the customer page, the fields filled and "Salva modifiche"', async () => {
    renderEdit(MARIA.id);
    expect(await nameField()).toHaveValue('Maria Rossi');
    expect(screen.getByRole('heading', { level: 1, name: 'Modifica cliente' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Indietro' }),
    ).toHaveAttribute('href', `/clienti/${MARIA.id}`);
    expect(screen.getByRole('textbox', { name: PHONE })).toHaveValue('333 123 4521');
    expect(screen.getByRole('textbox', { name: NOTES })).toHaveValue('Preferisce il caffè d’orzo');
    expect(screen.getByRole('button', { name: SAVE })).toBeInTheDocument();
  });

  it('has no PRIVACY section: the consent is given once', async () => {
    renderEdit(MARIA.id);
    await nameField();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVACY')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mostra l’informativa' })).not.toBeInTheDocument();
    // Like the wireframe Modifica cliente: no help text under the fields.
    expect(screen.queryByText(/Il nome identifica il cliente/)).not.toBeInTheDocument();
  });

  it('a foreign phone is shown in E.164, a missing phone and notes as empty fields', async () => {
    renderEdit(LUCA.id);
    await nameField();
    expect(screen.getByRole('textbox', { name: PHONE })).toHaveValue('+447911123456');
    cleanup();
    renderEdit(ROSA.id);
    expect(await nameField()).toHaveValue('Rosa Verdi');
    expect(screen.getByRole('textbox', { name: PHONE })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: NOTES })).toHaveValue('');
  });

  it('saves the changes and opens the customer page, replacing Modifica in the history', async () => {
    const { customers, router } = renderEdit(MARIA.id);
    await nameField();
    await retype(PHONE, '333 765 4321');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(customers.service.update).toHaveBeenCalledWith({
      id: MARIA.id,
      name: 'Maria Rossi',
      phone: '333 765 4321',
      notes: 'Preferisce il caffè d’orzo',
    });
    expect(await screen.findByText('Tel. 333 ••• 4321')).toBeInTheDocument();
  });

  it('an emptied phone is sent as empty and removes it', async () => {
    const { customers, router } = renderEdit(MARIA.id);
    await nameField();
    await retype(PHONE, '');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(customers.service.update.mock.calls[0]?.[0]).toMatchObject({ phone: '' });
    expect(stored(customers, MARIA.id)?.phone).toBeNull();
  });

  it('checks the form in the app: an empty name calls no service', async () => {
    const { customers } = renderEdit(MARIA.id);
    await nameField();
    await retype(NAME, '');
    await retype(PHONE, '12');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    expect(screen.getByRole('textbox', { name: NAME })).toHaveFocus();
    expect(screen.getByText('Scrivi nome e cognome.')).toBeInTheDocument();
    expect(
      screen.getByText('Numero non valido: scrivi solo le cifre, con o senza prefisso.'),
    ).toBeInTheDocument();
    expect(customers.service.update).not.toHaveBeenCalled();
  });

  it('is busy while saving: a double tap sends one request', async () => {
    const customers = customersFake();
    const { router } = renderEdit(MARIA.id, customers);
    await nameField();
    const hold = customers.holdNext('update');
    const button = screen.getByRole('button', { name: SAVE });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(screen.getByRole('textbox', { name: NAME }));
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(customers.service.update).toHaveBeenCalledTimes(1);

    await act(async () => hold.release());
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
  });

  it('name already used: the error and "Apri la scheda" to the other customer', async () => {
    const { customers } = renderEdit(MARIA.id);
    await nameField();
    await retype(NAME, 'luca bianchi');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));

    const link = await screen.findByRole('link', { name: 'Apri la scheda' });
    expect(link).toHaveAttribute('href', `/clienti/${LUCA.id}`);
    const name = screen.getByRole('textbox', { name: NAME });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription(
      'Esiste già un cliente con questo nome. Apri la scheda Se è un’altra persona, aggiungi un dettaglio al nome, per esempio «Maria Rossi Serapo».',
    );
    expect(screen.getByRole('button', { name: SAVE })).not.toHaveAttribute('aria-busy');
    expect(stored(customers, MARIA.id)?.name).toBe('Maria Rossi');
  });

  it('shows a refusal of the server under its field', async () => {
    const customers = customersFake();
    renderEdit(MARIA.id, customers);
    await nameField();
    customers.failNext('update', 'phone_invalid');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));

    const phone = screen.getByRole('textbox', { name: PHONE });
    await waitFor(() =>
      expect(phone).toHaveAccessibleDescription(
        'Numero non valido: scrivi solo le cifre, con o senza prefisso.',
      ),
    );
    expect(phone).toHaveFocus();
  });

  it('network error: "Modifiche non salvate…" and "Riprova", which sends the changes again', async () => {
    const customers = customersFake();
    const { router } = renderEdit(MARIA.id, customers);
    await nameField();
    await retype(NOTES, 'Tavolo vicino alla finestra');
    customers.failNext('update', 'lost');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));

    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TEXT);
    expect(screen.queryByRole('button', { name: SAVE })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(customers.service.update).toHaveBeenCalledTimes(2);
    expect(customers.service.update.mock.calls[1]?.[0]).toEqual(
      customers.service.update.mock.calls[0]?.[0],
    );
    expect(stored(customers, MARIA.id)?.notes).toBe('Tavolo vicino alla finestra');
  });

  it('a server fault: its message and "Riprova"', async () => {
    const customers = customersFake();
    renderEdit(MARIA.id, customers);
    await nameField();
    customers.failNext('update', new ServerFaultError('misconfigured'));
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Servizio non configurato: chiedi a un amministratore.',
    );
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
  });

  it('the customer erased meanwhile: the save goes to the customer page instead', async () => {
    const customers = customersFake();
    const { router } = renderEdit(MARIA.id, customers);
    await nameField();
    customers.failNext('update', 'customer_anonymized');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('a customer whose data was erased is not edited: back to the customer page (replace)', async () => {
    const { router, customers } = renderEdit(ERASED.id);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Cliente cancellato' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/clienti/${ERASED.id}`);
    expect(router.state.historyAction).toBe('REPLACE');
    expect(customers.service.update).not.toHaveBeenCalled();
  });

  it('shows the loading state until the customer arrives', async () => {
    const customers = customersFake();
    const held = customers.holdNext('get');
    renderEdit(MARIA.id, customers);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Modifica cliente' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Caricamento…')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: NAME })).not.toBeInTheDocument();
    await act(async () => {
      held.release();
    });
    expect(await nameField()).toHaveValue('Maria Rossi');
  });

  it('a missing customer or an id that is not a uuid: "Cliente non trovato"', async () => {
    const missing = '00000000-0000-4000-8000-999999999999';
    renderEdit(missing);
    expect(await screen.findByRole('heading', { name: 'Cliente non trovato' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna all’inizio' })).toHaveAttribute('href', '/');
    cleanup();
    const { customers } = renderEdit('abc');
    expect(await screen.findByRole('heading', { name: 'Cliente non trovato' })).toBeInTheDocument();
    expect(customers.calls).toEqual([]);
  });

  it('a load error: says so and "Riprova" loads again', async () => {
    const customers = customersFake();
    customers.failNext('get', 'network');
    renderEdit(MARIA.id, customers);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Scheda non caricata');
    expect(alert).toHaveTextContent('Controlla la connessione e riprova.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await nameField()).toHaveValue('Maria Rossi');
  });

  it('after "Riprova" the focus stays on the page title, while loading and once the form is shown', async () => {
    const customers = customersFake();
    customers.failNext('get', 'network');
    renderEdit(MARIA.id, customers);
    const alert = await screen.findByRole('alert');
    const held = customers.holdNext('get');

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(screen.getByText('Caricamento…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Modifica cliente' })).toHaveFocus();
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    expect(await nameField()).toHaveValue('Maria Rossi');
    expect(screen.getByRole('heading', { level: 1, name: 'Modifica cliente' })).toHaveFocus();
  });

  it('the form opened without a "Riprova" does not take the focus', async () => {
    renderEdit(MARIA.id);
    await nameField();
    expect(document.activeElement).toBe(document.body);
  });

  it('not_operator on save: back to /accedi', async () => {
    const auth = signedInFake();
    const customers = customersFake();
    const { router } = renderEdit(MARIA.id, customers, auth);
    await nameField();
    auth.removeProfile();
    customers.failNext('update', 'not_operator');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });
});
