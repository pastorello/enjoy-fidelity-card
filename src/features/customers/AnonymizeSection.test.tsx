import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const SECTION = 'DATI DEL CLIENTE';
const OPEN = 'Cancella i dati del cliente';
const CONFIRM = 'Cancella i dati';
const TITLE = 'Cancellare i dati di Maria Rossi?';
const NETWORK_TEXT = 'Dati non cancellati: controlla la connessione e riprova.';
const FORBIDDEN_TEXT = 'Solo un amministratore può cancellare i dati di un cliente.';

const MARIA = fakeCustomer({ name: 'Maria Rossi', phone: '+393331234521', notes: 'Al banco' });

const operatorAuth = () =>
  signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role: 'operator' } });

function renderEdit(
  customers = createFakeCustomerService({ customers: [MARIA] }),
  auth = signedInFake(),
) {
  const rendered = renderApp(
    `/clienti/${MARIA.id}/modifica`,
    auth,
    createFakeSettingsService(),
    customers,
  );
  return { ...rendered, customers };
}

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: OPEN }));
  return screen.getByRole('dialog', { name: TITLE });
}

function stored(customers: ReturnType<typeof createFakeCustomerService>) {
  return customers.customers().find((customer) => customer.id === MARIA.id);
}

describe('AnonymizeSection: Cancellazione dei dati del cliente', () => {
  it('an admin sees DATI DEL CLIENTE, the danger button and what it does', async () => {
    renderEdit();
    const section = await screen.findByRole('region', { name: SECTION });
    const button = within(section).getByRole('button', { name: OPEN });
    expect(button).toHaveAttribute('data-variant', 'danger-secondary');
    expect(section).toHaveTextContent(
      'Nome e telefono si cancellano, i movimenti restano senza dati personali. Solo amministratori.',
    );
  });

  it('an operator does not see the section', async () => {
    renderEdit(undefined, operatorAuth());
    expect(await screen.findByRole('textbox', { name: 'Nome e cognome' })).toBeInTheDocument();
    expect(screen.queryByText(SECTION)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: OPEN })).not.toBeInTheDocument();
  });

  it('nothing is erased without the ConfirmDialog: "Lascia com’è" closes it and calls nothing', async () => {
    const { customers } = renderEdit();
    const dialog = await openDialog();
    expect(dialog).toHaveAccessibleDescription(
      'Nome, telefono e note si cancellano per sempre e la card si disattiva. I movimenti e il saldo restano, senza dati personali. Non si può tornare indietro.',
    );
    expect(within(dialog).getByRole('button', { name: CONFIRM })).toHaveAttribute(
      'data-variant',
      'danger',
    );
    // A dangerous action starts on the safe choice.
    expect(within(dialog).getByRole('button', { name: 'Lascia com’è' })).toHaveFocus();
    expect(customers.service.anonymize).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(customers.service.anonymize).not.toHaveBeenCalled();
    expect(stored(customers)?.anonymizedAt).toBeNull();
  });

  it('confirmed: busy while sending, then the home (replace) with "Dati del cliente cancellati."', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    const { router } = renderEdit(customers);
    const dialog = await openDialog();
    const hold = customers.holdNext('anonymize');
    const confirm = within(dialog).getByRole('button', { name: CONFIRM });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(customers.service.anonymize).toHaveBeenCalledTimes(1);
    expect(customers.service.anonymize).toHaveBeenCalledWith(MARIA.id);

    await act(async () => hold.release());
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Dati del cliente cancellati.'),
    );
    expect(stored(customers)?.anonymizedAt).not.toBeNull();
  });

  it('network error: the dialog stays open with the message, and a new try erases', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    const { router } = renderEdit(customers);
    const dialog = await openDialog();
    customers.failNext('anonymize', 'network');
    await userEvent.click(within(dialog).getByRole('button', { name: CONFIRM }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NETWORK_TEXT);
    expect(screen.getByRole('dialog', { name: TITLE })).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: CONFIRM });
    expect(confirm).not.toHaveAttribute('aria-busy');
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/modifica`);

    await userEvent.click(confirm);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(customers.service.anonymize).toHaveBeenCalledTimes(2);
  });

  it('an answer lost after the erase: the new try is safe (idempotent)', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    const { router } = renderEdit(customers);
    const dialog = await openDialog();
    customers.failNext('anonymize', 'lost');
    await userEvent.click(within(dialog).getByRole('button', { name: CONFIRM }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NETWORK_TEXT);

    await userEvent.click(within(dialog).getByRole('button', { name: CONFIRM }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Dati del cliente cancellati.'),
    );
  });

  it('a server fault: its message in the dialog, which stays open', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    renderEdit(customers);
    const dialog = await openDialog();
    customers.failNext('anonymize', new ServerFaultError('unavailable'));
    await userEvent.click(within(dialog).getByRole('button', { name: CONFIRM }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Servizio momentaneamente non disponibile: riprova tra poco.',
    );
  });

  it('a new try clears the old message, and closing the dialog forgets it', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    renderEdit(customers);
    let dialog = await openDialog();
    customers.failNext('anonymize', 'network');
    await userEvent.click(within(dialog).getByRole('button', { name: CONFIRM }));
    await within(dialog).findByRole('alert');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));

    dialog = await openDialog();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('forbidden (the role changed meanwhile): "Solo un amministratore…" and nothing erased', async () => {
    // The page still shows the section: the server says the caller is no longer an admin.
    const customers = createFakeCustomerService({ customers: [MARIA], role: 'operator' });
    const { router } = renderEdit(customers);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: CONFIRM }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(FORBIDDEN_TEXT);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/modifica`);
    expect(stored(customers)?.anonymizedAt).toBeNull();
  });

  it('not_operator: back to /accedi', async () => {
    const auth = signedInFake();
    const customers = createFakeCustomerService({ customers: [MARIA] });
    const { router } = renderEdit(customers, auth);
    const dialog = await openDialog();
    auth.removeProfile();
    customers.failNext('anonymize', 'not_operator');
    await userEvent.click(within(dialog).getByRole('button', { name: CONFIRM }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });
});
