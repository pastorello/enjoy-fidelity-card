import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeCustomerService } from '../../test/fakeCustomerService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

async function renderNewCustomer(path = '/clienti/nuovo') {
  const customers = createFakeCustomerService();
  const rendered = renderApp(path, signedInFake(), createFakeSettingsService(), customers);
  await screen.findByRole('textbox', { name: 'Nome e cognome' });
  return { ...rendered, customers };
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

  it('needs a signed-in operator', async () => {
    renderApp('/clienti/nuovo');
    expect(await screen.findByRole('heading', { name: 'Accedi' })).toBeInTheDocument();
  });
});
