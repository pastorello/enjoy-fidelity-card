import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const MARIA = fakeCustomer({ name: 'Maria Rossi', phone: '+393331234521' });
const GIULIA = fakeCustomer({ name: 'Giulia Bianchi' });

/** Invented uid; associated on 3 November of the current year, so the date has no year. */
const UID = '04A1B2C3D4E5F6';
const SINCE = `${new Date().getFullYear()}-11-03T10:00:00.000Z`;

const DIALOG_TITLE = 'Disattivare la card …E5F6?';
const DIALOG_TEXT =
  'La card non aprirà più la scheda di Maria e il suo link non mostrerà più i punti. I punti restano a Maria.';

function setup() {
  const customers = createFakeCustomerService({ customers: [MARIA, GIULIA] });
  const cards = createFakeCardsService({
    customers,
    cards: [fakeCard({ uid: UID, customerId: MARIA.id, associatedAt: SINCE })],
  });
  return { customers, cards };
}

type Fixture = ReturnType<typeof setup>;

function renderEdit(fixture: Fixture, customerId = MARIA.id) {
  return renderApp(
    `/clienti/${customerId}/modifica`,
    signedInFake(),
    createFakeSettingsService(),
    fixture.customers,
    createFakeRewardsService(),
    createTestCardReader(),
    fixture.cards,
  );
}

async function cardSection() {
  return screen.findByRole('region', { name: 'CARD' });
}

async function openDialog() {
  const section = await cardSection();
  await userEvent.click(await within(section).findByRole('button', { name: 'Disattiva card' }));
  return screen.getByRole('dialog', { name: DIALOG_TITLE });
}

describe('CustomerCardSection: CARD of Modifica cliente (SPEC-cards, point 5)', () => {
  it('with an active card: the card, the day it was given, "Sostituisci card" and "Disattiva card"', async () => {
    renderEdit(setup());
    const section = await cardSection();
    expect(await within(section).findByText(/Card attiva …E5F6/)).toBeInTheDocument();
    expect(section).toHaveTextContent('Card attiva …E5F6 · dal 3 nov');
    expect(within(section).getByRole('link', { name: 'Sostituisci card' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/card`,
    );
    expect(within(section).getByRole('button', { name: 'Disattiva card' })).toBeInTheDocument();
  });

  it('without an active card: «Nessuna card attiva» and "Associa card"', async () => {
    renderEdit(setup(), GIULIA.id);
    const section = await cardSection();
    expect(await within(section).findByText('Nessuna card attiva')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Associa card' })).toHaveAttribute(
      'href',
      `/clienti/${GIULIA.id}/card`,
    );
    expect(within(section).queryByRole('button', { name: 'Disattiva card' })).toBeNull();
  });

  it('"Disattiva card" asks first; "Lascia com’è" changes nothing', async () => {
    const fixture = setup();
    renderEdit(fixture);
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent(DIALOG_TEXT);
    expect(within(dialog).getByRole('button', { name: 'Disattiva card' })).toHaveAttribute(
      'data-variant',
      'danger',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fixture.cards.calls.some((call) => call.method === 'deactivate')).toBe(false);
    expect(await cardSection()).toHaveTextContent('Card attiva …E5F6');
  });

  it('confirmed: the card is deactivated and the section says «Nessuna card attiva», the form untouched', async () => {
    const fixture = setup();
    renderEdit(fixture);
    const name = await screen.findByRole('textbox', { name: 'Nome e cognome' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Maria Rossi Bis');

    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disattiva card' }));

    const section = await cardSection();
    await waitFor(() => expect(section).toHaveTextContent('Nessuna card attiva'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Associa card' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/card`,
    );
    expect(fixture.cards.cards().find((card) => card.uid === UID)?.active).toBe(false);
    // The card is saved on its own: the form keeps what was typed, and nothing else was saved.
    expect(name).toHaveValue('Maria Rossi Bis');
    expect(fixture.customers.customers().find((c) => c.id === MARIA.id)?.name).toBe('Maria Rossi');
  });

  it('"Disattiva card" again after a network error does not fail (criterion 7)', async () => {
    const fixture = setup();
    // Applied by the server, but the answer never arrives.
    fixture.cards.failNext('deactivate', 'lost');
    renderEdit(fixture);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disattiva card' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Card non disattivata: controlla la connessione.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Riprova' }));

    const section = await cardSection();
    await waitFor(() => expect(section).toHaveTextContent('Nessuna card attiva'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const deactivations = fixture.cards.calls.filter((call) => call.method === 'deactivate');
    expect(deactivations).toHaveLength(2);
    expect(deactivations[0]?.args).toEqual(deactivations[1]?.args);
  });

  it('a server fault while deactivating is worded as such, and the dialog stays open', async () => {
    const fixture = setup();
    fixture.cards.failNext('deactivate', new ServerFaultError('unavailable'));
    renderEdit(fixture);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disattiva card' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Card non disattivata. Servizio momentaneamente non disponibile: riprova tra poco.',
    );
  });

  it('a card that cannot be loaded: «Card non caricata» with "Riprova", and the form still works', async () => {
    const fixture = setup();
    fixture.cards.failNext('getActiveCard', 'network');
    renderEdit(fixture);
    const section = await cardSection();
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent('Card non caricata');

    // The rest of the form is usable meanwhile.
    const name = screen.getByRole('textbox', { name: 'Nome e cognome' });
    await userEvent.type(name, ' Bis');
    expect(name).toHaveValue('Maria Rossi Bis');
    expect(screen.getByRole('button', { name: 'Salva modifiche' })).toBeEnabled();

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await within(section).findByText(/Card attiva …E5F6/)).toBeInTheDocument();
  });
});
