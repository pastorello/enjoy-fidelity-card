import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestCardReader } from '../../test/fakeCardReader';
import { driveLinkWrites, type LinkWriteCall } from '../../test/fakeLinkWrites';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { NewCustomerCardPanel, RegisteredCustomerHint } from './NewCustomerCardPanel';
import { CardTakenError } from './types';

const UID = '04A1B2C3D4E5F6';
const NAME = 'Nome e cognome';
const NETWORK_TEXT = 'Cliente non salvato: controlla la connessione e riprova.';
const CONSENT = /Ha letto l’informativa privacy/;

function renderAlone(element: ReactNode) {
  const router = createMemoryRouter([{ path: '/', element }], { initialEntries: ['/'] });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NewCustomerCardPanel', () => {
  it('says the card read is new and shows its full code', () => {
    renderAlone(<NewCustomerCardPanel uid={UID} />);
    const panel = screen.getByRole('region', { name: 'Card letta' });
    expect(panel).toHaveTextContent('Card nuova letta');
    expect(panel).toHaveTextContent(
      `Codice ${UID}: non è di nessun cliente, verrà associata a questo.`,
    );
  });

  it('the hint links to the home, to look for a customer already registered', () => {
    renderAlone(<RegisteredCustomerHint />);
    expect(screen.getByText(/È la nuova card di un cliente già registrato\?/)).toHaveTextContent(
      'È la nuova card di un cliente già registrato? Cerca il cliente e associa la card dalla sua scheda.',
    );
    expect(screen.getByRole('link', { name: 'Cerca il cliente' })).toHaveAttribute('href', '/');
  });
});

function setup({ customers = createFakeCustomerService() } = {}) {
  const cards = createFakeCardsService({ customers });
  return { customers, cards };
}

/** Nuovo cliente opened by the home with `card` in the history state (SPEC-customers-v2 point 6). */
function fromHome(card: unknown, search = ''): InitialEntry {
  return { pathname: '/clienti/nuovo', search, state: { card } };
}

async function renderNewFromCard(path: InitialEntry = fromHome(UID), fixture = setup()) {
  const card = createTestCardReader();
  // The link writes after the save wait for the test.
  const writes = driveLinkWrites(card.reader);
  const rendered = renderApp(
    path,
    signedInFake(),
    createFakeSettingsService(),
    fixture.customers,
    createFakeRewardsService(),
    card,
    fixture.cards,
  );
  await screen.findByRole('textbox', { name: NAME });
  return { ...rendered, writes };
}

/** The link write after the save, ended as written. */
async function finishWrite(writes: LinkWriteCall[]) {
  await waitFor(() => expect(writes).toHaveLength(1));
  await writes[0]?.finish({ ok: true });
}

async function fillValid(name = 'Maria Rossi') {
  const field = screen.getByRole('textbox', { name: NAME });
  await userEvent.clear(field);
  await userEvent.type(field, name);
  const consent = screen.getByRole('checkbox', { name: CONSENT });
  if (consent instanceof HTMLInputElement && !consent.checked) await userEvent.click(consent);
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: /^(Salva cliente|Riprova)$/ }));
}

type Cards = ReturnType<typeof createFakeCardsService>;

function withCardOperationIds(cards: Cards): string[] {
  return cards.service.createCustomerWithCard.mock.calls.map(([input]) => input.operationId);
}

function takenBy(owner: ConstructorParameters<typeof CardTakenError>[0]) {
  const fixture = setup();
  fixture.cards.failNext('createCustomerWithCard', new CardTakenError(owner));
  return fixture;
}

async function saveTaken(fixture: ReturnType<typeof setup>) {
  const rendered = await renderNewFromCard(undefined, fixture);
  await fillValid('Maria Rossi');
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Email (facoltativa)' }),
    'maria.rossi@example.com',
  );
  save();
  const notice = await screen.findByRole('alert');
  return { ...rendered, notice };
}

describe('Nuovo cliente da card nuova (/clienti/nuovo, card in the history state)', () => {
  it('email already used: refused with the card, the error under the email and "Apri la scheda"', async () => {
    const existing = fakeCustomer({ name: 'Anna Verdi', email: 'anna@example.com' });
    const fixture = setup({ customers: createFakeCustomerService({ customers: [existing] }) });
    await renderNewFromCard(undefined, fixture);
    await fillValid('Anna Bianchi');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Email (facoltativa)' }),
      'ANNA@example.com',
    );
    save();

    const link = await screen.findByRole('link', { name: 'Apri la scheda' });
    expect(link).toHaveAttribute('href', `/clienti/${existing.id}`);
    const email = screen.getByRole('textbox', { name: 'Email (facoltativa)' });
    expect(email).toHaveFocus();
    expect(email).toHaveAccessibleDescription(
      'Esiste già un cliente con questa email. Apri la scheda',
    );
    expect(fixture.cards.service.createCustomerWithCard).toHaveBeenCalledTimes(1);
    expect(fixture.cards.cards()).toEqual([]);
    // The card read stays: the next save sends it again.
    expect(screen.getByRole('region', { name: 'Card letta' })).toBeVisible();
  });

  it('shows "Card letta" with the full code above the form, and the hint to the home', async () => {
    await renderNewFromCard();
    expect(screen.getByRole('heading', { level: 1, name: 'Nuovo cliente' })).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'Card letta' });
    expect(panel).toHaveTextContent(`Codice ${UID}`);
    // Above the form, as in the wireframe.
    const name = screen.getByRole('textbox', { name: NAME });
    expect(panel.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cerca il cliente' })).toHaveAttribute('href', '/');
  });

  it('accepts the uid in any hex spelling and shows it canonical', async () => {
    await renderNewFromCard(fromHome('04:a1:b2:c3:d4:e5:f6'));
    expect(screen.getByRole('region', { name: 'Card letta' })).toHaveTextContent(`Codice ${UID}:`);
  });

  it.each<[string, InitialEntry]>([
    ['empty', fromHome('')],
    ['zz', fromHome('zz')],
    ['all zeros', fromHome('0000000000')],
    ['too short', fromHome('04A1B')],
    ['not a string', fromHome(4)],
    ['in the URL only (?card=)', `/clienti/nuovo?card=${UID}`],
  ])('ignores a card %s: the form without a card, saved with create', async (_label, entry) => {
    const fixture = setup();
    const { router } = await renderNewFromCard(entry, fixture);
    expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cerca il cliente' })).not.toBeInTheDocument();
    await fillValid();
    save();
    const [saved] = fixture.customers.customers();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved?.id}`));
    expect(fixture.cards.service.createCustomerWithCard).not.toHaveBeenCalled();
    expect(fixture.cards.cards()).toEqual([]);
  });

  it('saves customer and card together, then replaces the form with Registra spesa', async () => {
    const fixture = setup();
    const { router, writes } = await renderNewFromCard(undefined, fixture);
    await fillValid();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Email (facoltativa)' }),
      'Giulia@Example.com',
    );
    save();

    await finishWrite(writes);
    const [saved] = fixture.customers.customers();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved?.id}/spesa`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fixture.customers.service.create).not.toHaveBeenCalled();
    expect(fixture.cards.service.createCustomerWithCard).toHaveBeenCalledTimes(1);
    expect(fixture.cards.service.createCustomerWithCard.mock.calls[0]?.[0]).toMatchObject({
      uid: UID,
      name: 'Maria Rossi',
      phone: '',
      // As typed: the server normalizes it.
      email: 'Giulia@Example.com',
      privacyConsent: true,
      notes: '',
    });
    expect(fixture.cards.cards()).toMatchObject([
      { uid: UID, customerId: saved?.id, active: true },
    ]);
    // The link is written on the card saved, before Registra spesa opens.
    expect(writes[0]?.options.expectedUid).toBe(UID);
    expect(fixture.cards.service.confirmLink).toHaveBeenCalledOnce();
  });

  it('network error: "Riprova" resends the same operation_id, one customer and one card', async () => {
    const fixture = setup();
    const { router, writes } = await renderNewFromCard(undefined, fixture);
    await fillValid();
    fixture.cards.failNext('createCustomerWithCard', 'lost');
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await finishWrite(writes);

    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/spesa$/));
    const [first, second] = withCardOperationIds(fixture.cards);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
    expect(fixture.customers.customers()).toHaveLength(1);
    expect(fixture.cards.cards()).toHaveLength(1);
  });

  it('is busy while saving: a double tap sends one request', async () => {
    const fixture = setup();
    await renderNewFromCard(undefined, fixture);
    await fillValid();
    const hold = fixture.cards.holdNext('createCustomerWithCard');
    save();
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));
    expect(fixture.cards.service.createCustomerWithCard).toHaveBeenCalledTimes(1);
    await act(async () => hold.release());
    await waitFor(() => expect(fixture.customers.customers()).toHaveLength(1));
  });

  describe('card taken meanwhile (card_taken)', () => {
    const ANTONIO = '00000000-0000-4000-8000-0000000000aa';

    it('no customer created, the notice with the owner, the form intact', async () => {
      const fixture = takenBy({ customerId: ANTONIO, name: 'Antonio Esposito', active: true });
      const { notice, router } = await saveTaken(fixture);
      expect(within(notice).getByRole('heading', { name: 'Card già associata' })).toBeVisible();
      expect(notice).toHaveTextContent(
        'Questa card è di Antonio Esposito. Una card può essere di un solo cliente: usa un’altra card.',
      );
      expect(
        within(notice).getByRole('link', { name: 'Apri la scheda di Antonio' }),
      ).toHaveAttribute('href', `/clienti/${ANTONIO}`);
      expect(within(notice).getByRole('button', { name: 'Continua senza card' })).toBeVisible();
      // The card panel gives way to the notice.
      expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
      expect(fixture.customers.customers()).toEqual([]);
      expect(router.state.location.state).toEqual({ card: UID });
      expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Maria Rossi');
      expect(screen.getByRole('textbox', { name: 'Email (facoltativa)' })).toHaveValue(
        'maria.rossi@example.com',
      );
      expect(screen.getByRole('checkbox', { name: CONSENT })).toBeChecked();
    });

    it('a deactivated card says "era di"', async () => {
      const fixture = takenBy({ customerId: ANTONIO, name: 'Antonio Esposito', active: false });
      const { notice } = await saveTaken(fixture);
      expect(notice).toHaveTextContent(
        'Questa card era di Antonio Esposito. Una card può essere di un solo cliente: usa un’altra card.',
      );
    });

    it('an erased owner: no name and no "Apri la scheda"', async () => {
      const fixture = takenBy({ customerId: ANTONIO, name: null, active: false });
      const { notice } = await saveTaken(fixture);
      expect(notice).toHaveTextContent(
        'Questa card era di un cliente i cui dati sono stati cancellati. Una card può essere di un solo cliente: usa un’altra card.',
      );
      expect(within(notice).queryByRole('link')).not.toBeInTheDocument();
      expect(within(notice).getByRole('button', { name: 'Continua senza card' })).toBeVisible();
    });

    it('the owner unknown: a neutral text, no "Apri la scheda"', async () => {
      const fixture = takenBy(null);
      const { notice } = await saveTaken(fixture);
      expect(notice).toHaveTextContent(
        'Questa card è già di un altro cliente. Una card può essere di un solo cliente: usa un’altra card.',
      );
      expect(within(notice).queryByRole('link')).not.toBeInTheDocument();
    });

    it('"Continua senza card" drops the card, keeps the data, saves with create and the same operation_id', async () => {
      const fixture = takenBy({ customerId: ANTONIO, name: 'Antonio Esposito', active: true });
      const { notice, router } = await saveTaken(fixture);
      fireEvent.click(within(notice).getByRole('button', { name: 'Continua senza card' }));

      await waitFor(() => expect(router.state.location.state).toBeNull());
      expect(router.state.location.search).toBe('');
      expect(router.state.location.pathname).toBe('/clienti/nuovo');
      expect(router.state.historyAction).toBe('REPLACE');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Maria Rossi');
      expect(screen.getByRole('checkbox', { name: CONSENT })).toBeChecked();

      save();
      const [saved] = fixture.customers.customers();
      await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved?.id}`));
      expect(saved?.name).toBe('Maria Rossi');
      const [withCard] = withCardOperationIds(fixture.cards);
      expect(fixture.customers.service.create).toHaveBeenCalledTimes(1);
      expect(fixture.customers.service.create.mock.calls[0]?.[0].operationId).toBe(withCard);
      expect(fixture.cards.cards()).toEqual([]);
    });
  });

  describe('the form errors stay those of customers', () => {
    it('name already used: the error under the name, nothing created', async () => {
      const existing = fakeCustomer({ name: 'Maria Rossi' });
      const fixture = setup({ customers: createFakeCustomerService({ customers: [existing] }) });
      await renderNewFromCard(undefined, fixture);
      await fillValid('maria rossi');
      save();
      expect(await screen.findByText('Esiste già un cliente con questo nome.')).toBeVisible();
      expect(screen.getByRole('link', { name: 'Apri la scheda' })).toHaveAttribute(
        'href',
        `/clienti/${existing.id}`,
      );
      expect(screen.getByRole('region', { name: 'Card letta' })).toBeVisible();
      expect(fixture.cards.cards()).toEqual([]);
    });

    it('checks the form in the app: an invalid form calls no service', async () => {
      const fixture = setup();
      await renderNewFromCard(undefined, fixture);
      save();
      expect(screen.getByText('Scrivi nome e cognome.')).toBeInTheDocument();
      expect(
        screen.getByText('Serve il consenso privacy per registrare il cliente.'),
      ).toBeInTheDocument();
      expect(fixture.cards.calls).toEqual([]);
    });

    it('a card read meanwhile by another customer is not the case of a known card on the page', async () => {
      // A card already known when the form opens is still saved through the server, which refuses it.
      const owner = fakeCustomer({ name: 'Antonio Esposito' });
      const customers = createFakeCustomerService({ customers: [owner] });
      const cards = createFakeCardsService({
        customers,
        cards: [fakeCard({ uid: UID, customerId: owner.id })],
      });
      await renderNewFromCard(undefined, { customers, cards });
      await fillValid('Maria Rossi');
      save();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Questa card è di Antonio Esposito.',
      );
      expect(customers.customers()).toEqual([owner]);
    });
  });
});
