import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const MARIA = fakeCustomer({ name: 'Maria Rossi', phone: '+393330004521', balance: 120 });
const GIULIA = fakeCustomer({ name: 'Giulia Bianchi', balance: 0 });
const ANTONIO = fakeCustomer({ name: 'Antonio Esposito', balance: 40 });
const ERASED = fakeCustomer({ name: 'cancellato-7f3a', anonymizedAt: '2026-11-17T09:00:00.000Z' });

/** Uids as Web NFC gives them, and as the app keeps them. Invented. */
const OF_MARIA = { read: '04:a1:b2:c3:d4:e5:f6', uid: '04A1B2C3D4E5F6' };
const LOST = { read: '04:11:22:33:44:55:66', uid: '04112233445566' };
const OF_ANTONIO = { read: '04:aa:bb:cc:dd:ee:01', uid: '04AABBCCDDEE01' };
const ANTONIO_OLD = { read: '04:aa:bb:cc:dd:ee:02', uid: '04AABBCCDDEE02' };
const OF_ERASED = { read: '04:77:88:99:aa:bb:cc', uid: '04778899AABBCC' };
const NEW_ONE = { read: '04:de:ad:be:ef:00:01', uid: '04DEADBEEF0001' };
const NEW_TWO = { read: '04:de:ad:be:ef:00:02', uid: '04DEADBEEF0002' };

const PANEL_TITLE = 'Avvicina la card nuova';
const PANEL_TEXT = 'L’app legge il codice della card e ci scrive il link per vedere i punti.';
const ONE_CUSTOMER = 'Una card può essere di un solo cliente: usa un’altra card.';
const NOTE = 'La card attuale (…E5F6) verrà disattivata. I punti restano a Maria.';

function setup({ auth = signedInFake() } = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA, GIULIA, ANTONIO, ERASED] });
  const cards = createFakeCardsService({
    customers,
    cards: [
      fakeCard({ uid: OF_MARIA.uid, customerId: MARIA.id }),
      fakeCard({
        uid: LOST.uid,
        customerId: MARIA.id,
        active: false,
        deactivatedAt: '2026-11-16T10:00:00.000Z',
      }),
      fakeCard({ uid: OF_ANTONIO.uid, customerId: ANTONIO.id }),
      fakeCard({
        uid: ANTONIO_OLD.uid,
        customerId: ANTONIO.id,
        active: false,
        deactivatedAt: '2026-11-15T10:00:00.000Z',
      }),
      fakeCard({ uid: OF_ERASED.uid, customerId: ERASED.id, active: false }),
    ],
  });
  const card = createTestCardReader();
  return { customers, cards, card, auth };
}

type Fixture = ReturnType<typeof setup>;

function renderPage(fixture: Fixture, customerId: string) {
  return renderApp(
    `/clienti/${customerId}/card`,
    fixture.auth,
    createFakeSettingsService(),
    fixture.customers,
    createFakeRewardsService(),
    fixture.card,
    fixture.cards,
  );
}

/** The page of `customerId` once reading is on. */
async function renderReading(fixture: Fixture = setup(), customerId = MARIA.id) {
  const rendered = renderPage(fixture, customerId);
  const panel = await screen.findByRole('region', { name: 'Lettura card' });
  await within(panel).findByText(PANEL_TEXT);
  return rendered;
}

function tap(fixture: Fixture, read: string) {
  act(() => {
    fixture.card.nfc.read(read);
  });
}

function associations(fixture: Fixture) {
  return fixture.cards.calls.filter((call) => call.method === 'associate').map((call) => call.args);
}

/** The one-time confirmation of the customer page, written a moment after the page opens. */
async function expectConfirmation(text: string) {
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text));
}

function cardOf(fixture: Fixture, uid: string) {
  return fixture.cards.cards().find((card) => card.uid === uid);
}

describe('AssociateCardPage: the screen of the wireframe "Associa o sostituisci card"', () => {
  it('header, customer row, reading panel, the note on the current card and "Annulla"', async () => {
    await renderReading();

    expect(screen.getByRole('heading', { level: 1, name: 'Associa card' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/modifica`,
    );
    const row = screen.getByRole('link', { name: /Maria Rossi/ });
    expect(row).toHaveAttribute('href', `/clienti/${MARIA.id}`);
    expect(row).toHaveTextContent('120 pt');

    const panel = screen.getByRole('region', { name: 'Lettura card' });
    expect(panel).toHaveTextContent(PANEL_TITLE);
    expect(panel).toHaveTextContent(PANEL_TEXT);
    // The note follows the panel, as in the wireframe.
    const note = screen.getByText(NOTE);
    expect(panel.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByRole('link', { name: 'Annulla' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/modifica`,
    );
  });

  it('without an active card there is no note (criterion 5)', async () => {
    await renderReading(setup(), GIULIA.id);
    expect(screen.getByRole('link', { name: /Giulia Bianchi/ })).toBeInTheDocument();
    expect(screen.queryByText(/La card attuale/)).not.toBeInTheDocument();
  });

  it('a card that cannot be loaded: an error with "Riprova", then the screen', async () => {
    const fixture = setup();
    fixture.cards.failNext('getActiveCard', 'network');
    renderPage(fixture, MARIA.id);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Card non caricata');
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
  });
});

describe('AssociateCardPage: what the association answers (SPEC-cards, point 4)', () => {
  it('a new card replaces the active one; the customer page opens with the confirmation (criterion 3)', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture);
    tap(fixture, NEW_ONE.read);

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(associations(fixture)).toEqual([[MARIA.id, NEW_ONE.uid]]);
    await expectConfirmation('Card …0001 associata. Link non scritto.');
    expect(cardOf(fixture, NEW_ONE.uid)?.active).toBe(true);
    expect(cardOf(fixture, OF_MARIA.uid)).toMatchObject({ active: false });
    expect(cardOf(fixture, OF_MARIA.uid)?.deactivatedAt).not.toBeNull();
    // Nothing writes the link yet: no token is issued.
    expect(fixture.cards.service.issueLink).not.toHaveBeenCalled();
  });

  it('a first card for a customer without one', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture, GIULIA.id);
    tap(fixture, NEW_ONE.read);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${GIULIA.id}`));
    await expectConfirmation('Card …0001 associata. Link non scritto.');
  });

  it('the customer’s own deactivated card is reactivated, with the outcome of a success', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture);
    tap(fixture, LOST.read);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    await expectConfirmation('Card …5566 associata. Link non scritto.');
    expect(cardOf(fixture, LOST.uid)?.active).toBe(true);
    expect(cardOf(fixture, OF_MARIA.uid)?.active).toBe(false);
  });

  it('the card already active for this customer: said, nothing changes', async () => {
    const fixture = setup();
    const before = fixture.cards.cards();
    const { router } = await renderReading(fixture);
    tap(fixture, OF_MARIA.read);

    expect(await screen.findByText('Questa è già la card attiva di Maria.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/card`);
    expect(fixture.cards.cards()).toEqual(before);
    // The note about replacing it would be wrong now.
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('a card of another customer: "Card già associata" with the texts of the wireframe (criterion 5)', async () => {
    const fixture = setup();
    const before = fixture.cards.cards();
    const { router } = await renderReading(fixture);
    tap(fixture, OF_ANTONIO.read);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Card già associata');
    expect(alert).toHaveTextContent(`Questa card è di Antonio Esposito. ${ONE_CUSTOMER}`);
    // Panel, note and "Annulla" give way to the notice; header and customer row stay.
    expect(screen.queryByRole('region', { name: 'Lettura card' })).not.toBeInTheDocument();
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Annulla' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Associa card' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
    expect(fixture.cards.cards()).toEqual(before);

    // Reads are ignored meanwhile.
    tap(fixture, NEW_ONE.read);
    expect(associations(fixture)).toEqual([[MARIA.id, OF_ANTONIO.uid]]);

    const open = screen.getByRole('link', { name: 'Apri la scheda di Antonio' });
    expect(open).toHaveAttribute('href', `/clienti/${ANTONIO.id}`);

    await userEvent.click(screen.getByRole('button', { name: 'Riprova con un’altra card' }));
    const panel = await screen.findByRole('region', { name: 'Lettura card' });
    expect(panel).toHaveTextContent(PANEL_TEXT);
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    tap(fixture, NEW_TWO.read);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(associations(fixture)).toEqual([
      [MARIA.id, OF_ANTONIO.uid],
      [MARIA.id, NEW_TWO.uid],
    ]);
  });

  it('"Apri la scheda di Antonio" opens his customer page', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture);
    tap(fixture, OF_ANTONIO.read);
    await userEvent.click(await screen.findByRole('link', { name: 'Apri la scheda di Antonio' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${ANTONIO.id}`));
  });

  it('a deactivated card of another customer: "era di"', async () => {
    const fixture = setup();
    await renderReading(fixture);
    tap(fixture, ANTONIO_OLD.read);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Questa card era di Antonio Esposito. ${ONE_CUSTOMER}`,
    );
    expect(screen.getByRole('link', { name: 'Apri la scheda di Antonio' })).toBeInTheDocument();
  });

  it('the card of an erased customer: no name and no customer page', async () => {
    const fixture = setup();
    await renderReading(fixture);
    tap(fixture, OF_ERASED.read);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      `Questa card era di un cliente i cui dati sono stati cancellati. ${ONE_CUSTOMER}`,
    );
    expect(screen.queryByText(/cancellato-7f3a/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Apri la scheda/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riprova con un’altra card' })).toBeInTheDocument();
  });

  it('"Associazione in corso…" while saving; reads are ignored', async () => {
    const fixture = setup();
    const held = fixture.cards.holdNext('associate');
    const { router } = await renderReading(fixture);
    tap(fixture, NEW_ONE.read);

    const panel = screen.getByRole('region', { name: 'Lettura card' });
    expect(await within(panel).findByText('Associazione in corso…')).toBeInTheDocument();
    tap(fixture, NEW_TWO.read);
    expect(associations(fixture)).toEqual([[MARIA.id, NEW_ONE.uid]]);

    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(cardOf(fixture, NEW_TWO.uid)).toBeUndefined();
  });

  it('no answer: "Card non associata", and "Riprova" sends the same uid again (criterion 7)', async () => {
    const fixture = setup();
    // The first request was applied, but its answer was lost.
    fixture.cards.failNext('associate', 'lost');
    const { router } = await renderReading(fixture);
    tap(fixture, NEW_ONE.read);

    const panel = screen.getByRole('region', { name: 'Lettura card' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Card non associata: controlla la connessione.',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Riprova' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(associations(fixture)).toEqual([
      [MARIA.id, NEW_ONE.uid],
      [MARIA.id, NEW_ONE.uid],
    ]);
    await expectConfirmation('Card …0001 associata. Link non scritto.');
    // One card, active, the old one replaced once.
    expect(fixture.cards.cards().filter((card) => card.uid === NEW_ONE.uid)).toHaveLength(1);
    expect(cardOf(fixture, OF_MARIA.uid)?.active).toBe(false);
  });

  it('not_operator: back to /accedi (reportNotEnabled)', async () => {
    const fixture = setup();
    fixture.cards.failNext('associate', 'not_operator');
    const held = fixture.cards.holdNext('associate');
    const { router } = await renderReading(fixture);
    tap(fixture, NEW_ONE.read);
    fixture.auth.removeProfile();
    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
  });
});

describe('AssociateCardPage: a customer that cannot have a card', () => {
  it('an erased customer: "Questo cliente non può avere una card."', async () => {
    const fixture = setup();
    renderPage(fixture, ERASED.id);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Questo cliente non può avere una card.',
    );
    expect(screen.queryByRole('region', { name: 'Lettura card' })).not.toBeInTheDocument();
    expect(screen.queryByText(/cancellato-7f3a/)).not.toBeInTheDocument();
  });

  it('erased meanwhile (customer_anonymized): the same error', async () => {
    const fixture = setup();
    fixture.cards.failNext('associate', 'customer_anonymized');
    await renderReading(fixture);
    tap(fixture, NEW_ONE.read);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Questo cliente non può avere una card.',
    );
    expect(screen.queryByRole('region', { name: 'Lettura card' })).not.toBeInTheDocument();
  });

  it('a customer that does not exist: "Cliente non trovato"', async () => {
    renderPage(setup(), '00000000-0000-4000-8000-00000000dead');
    expect(await screen.findByText('Cliente non trovato')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Lettura card' })).not.toBeInTheDocument();
  });

  it('gone meanwhile (customer_not_found): "Cliente non trovato"', async () => {
    const fixture = setup();
    fixture.cards.failNext('associate', 'customer_not_found');
    await renderReading(fixture);
    tap(fixture, NEW_ONE.read);
    expect(await screen.findByText('Cliente non trovato')).toBeInTheDocument();
  });
});
