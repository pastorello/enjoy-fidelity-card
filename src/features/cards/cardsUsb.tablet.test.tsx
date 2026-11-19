import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDevice } from '../../test/fakeAuthService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { driveLinkWrites } from '../../test/fakeLinkWrites';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { stubLayout } from '../../test/stubLayout';

// SPEC-tablet-kiosk, point 8 (wireframes "Tablet: nuovo cliente" and "Tablet: associa card"): on
// the till tablet Nuovo cliente and Associa card read with the USB reader, say so with the texts
// of the wireframes, and associate the card read. The USB reader cannot write, so the link stays
// "non scritto". The same in a narrow window (portrait): the reader comes from the session.
// Invented customers and uids only.

const NAME = 'Nome e cognome';
const CONSENT = /Ha letto l’informativa privacy/;
const NEW_CUSTOMER_TEXT =
  'Passa una card nuova sul lettore per associarla adesso, oppure fallo più tardi dalla scheda.';
const ASSOCIATE_TITLE = 'Passa la card nuova sul lettore';
const ASSOCIATE_TEXT = 'L’app legge solo il codice della card: non ci scrive nulla.';

const MARIA = fakeCustomer({ name: 'Maria Rossi', phone: '+393330004521', balance: 120 });
/** As a USB reader in the default `hex` format types them. */
const OF_MARIA = '04A1B2C3D4E5F6';
const NEW_ONE = '04DEADBEEF0001';

const cashier = { id: 'op-2', name: 'Marco Prova', role: 'operator' as const };

/** A USB reader in keyboard emulation: a fast burst of keys closed by Enter. */
function usbBurst(text: string) {
  act(() => {
    for (const key of text) fireEvent.keyDown(document.body, { key });
    fireEvent.keyDown(document.body, { key: 'Enter' });
  });
}

/** The till tablet with a cashier on turn; Web NFC answers too, as Chrome may on a tablet. */
function renderTill(path: string) {
  const customers = createFakeCustomerService({ customers: [MARIA] });
  const cards = createFakeCardsService({
    customers,
    cards: [fakeCard({ uid: OF_MARIA, customerId: MARIA.id })],
  });
  const card = createTestCardReader();
  const writes = driveLinkWrites(card.reader);
  const rendered = renderApp(
    path,
    signedInFake({ device: fakeDevice, cashier }),
    createFakeSettingsService(),
    customers,
    createFakeRewardsService(),
    card,
    cards,
  );
  return { ...rendered, customers, cards, writes };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  ['1280×800', true],
  ['a narrow window', false],
])('Nuovo cliente on the till tablet at %s', (_label, wide) => {
  it('says to pass the card on the reader, with the texts of the wireframe', async () => {
    stubLayout(wide);
    renderTill('/clienti/nuovo');
    await screen.findByRole('textbox', { name: NAME });
    const section = await screen.findByRole('region', { name: 'Card' });
    expect(within(section).getByText('Card (facoltativa)')).toBeInTheDocument();
    expect(await within(section).findByText(NEW_CUSTOMER_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/avvicina una card nuova/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Attiva l’NFC/)).not.toBeInTheDocument();
  });

  it('a card read by the USB reader is saved with the customer; the link stays not written', async () => {
    stubLayout(wide);
    const { router, customers, cards, writes } = renderTill('/clienti/nuovo');
    await screen.findByText(NEW_CUSTOMER_TEXT);
    await userEvent.type(screen.getByRole('textbox', { name: NAME }), 'Giulia Bianchi');
    await userEvent.click(screen.getByRole('checkbox', { name: CONSENT }));

    usbBurst(NEW_ONE);

    const read = await screen.findByRole('region', { name: 'Card letta' });
    expect(read).toHaveTextContent(NEW_ONE);
    fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));

    const saved = await waitFor(() => {
      const customer = customers.customers().find((c) => c.name === 'Giulia Bianchi');
      if (!customer) throw new Error('not saved yet');
      return customer;
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved.id}`));
    expect(cards.cards()).toContainEqual(
      expect.objectContaining({
        uid: NEW_ONE,
        customerId: saved.id,
        active: true,
        linkState: 'not-written',
      }),
    );
    expect(cards.service.issueLink).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe.each([
  ['1280×800', true],
  ['a narrow window', false],
])('Associa card on the till tablet at %s', (_label, wide) => {
  it('says to pass the new card on the reader, with the texts of the wireframe', async () => {
    stubLayout(wide);
    renderTill(`/clienti/${MARIA.id}/card`);
    const panel = await screen.findByRole('region', { name: 'Lettura card' });
    expect(await within(panel).findByText(ASSOCIATE_TITLE)).toBeInTheDocument();
    expect(within(panel).getByText(ASSOCIATE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/Attiva l’NFC/)).not.toBeInTheDocument();
    expect(
      screen.getByText('La card attuale (…E5F6) verrà disattivata. I punti restano a Maria.'),
    ).toBeInTheDocument();
  });

  it('a card read by the USB reader is associated; the link stays not written', async () => {
    stubLayout(wide);
    const { router, cards, writes } = renderTill(`/clienti/${MARIA.id}/card`);
    await screen.findByText(ASSOCIATE_TEXT);

    usbBurst(NEW_ONE);

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(
      cards.calls.filter((call) => call.method === 'associate').map((call) => call.args),
    ).toEqual([[MARIA.id, NEW_ONE]]);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Card …0001 associata. Link non scritto.',
      ),
    );
    expect(cards.cards()).toContainEqual(
      expect.objectContaining({ uid: NEW_ONE, customerId: MARIA.id, linkState: 'not-written' }),
    );
    expect(cards.service.issueLink).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
