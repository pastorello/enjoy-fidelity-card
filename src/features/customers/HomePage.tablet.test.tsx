import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDevice } from '../../test/fakeAuthService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

// SPEC-tablet-kiosk, points 8 and 10, success criterion 5 (wireframe "Tablet: cerca cliente").
// Invented customers and uids only.

const TABLET_TITLE = 'Passa la card sul lettore';
const TABLET_TEXT =
  'L’app riceve il codice dal lettore da sola, senza bisogno di toccare un campo. Una card nuova apre la registrazione del cliente.';
const READY = 'Lettore USB pronto';
const UNRECOGNIZED = 'Codice non riconosciuto: controlla il formato del lettore in Impostazioni';
const PHONE_TITLE = 'Avvicina la card';

const MARIA = fakeCustomer({ name: 'Maria Rossi', phone: '+393330004521', balance: 120 });
/** As a USB reader in the default `hex` format types them. */
const KNOWN_UID = '04A1B2C3D4E5F6';
const UNKNOWN_UID = '04DEADBEEF0001';

const cashier = { id: 'op-2', name: 'Marco Prova', role: 'operator' as const };

/** A matchMedia that answers every query with `matches`: true is the 1280×800 tablet. */
function stubLayout(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** A USB reader in keyboard emulation: a fast burst of keys closed by Enter. */
function usbBurst(text: string) {
  act(() => {
    for (const key of text) fireEvent.keyDown(document.body, { key });
    fireEvent.keyDown(document.body, { key: 'Enter' });
  });
}

/** The till tablet with a cashier on turn, Maria's card registered; waits for the panel's `title`. */
async function renderTablet(title = TABLET_TITLE) {
  const customers = createFakeCustomerService({ customers: [MARIA] });
  const cards = createFakeCardsService({
    customers,
    cards: [fakeCard({ uid: KNOWN_UID, customerId: MARIA.id })],
  });
  const rendered = renderApp(
    '/',
    signedInFake({ device: fakeDevice, cashier }),
    createFakeSettingsService(),
    customers,
    createFakeRewardsService(),
    createTestCardReader(),
    cards,
  );
  const column = await screen.findByRole('region', { name: 'Lettura card' });
  await within(column).findByText(title);
  return rendered;
}

function readerStatus() {
  return screen.getByRole('status', { name: 'Stato del lettore USB' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HomePage at 1280×800 (wireframe "Tablet: cerca cliente")', () => {
  it('shows the reader column with the wireframe texts and "Lettore USB pronto"', async () => {
    stubLayout(true);
    await renderTablet();
    const panel = screen.getByRole('region', { name: 'Lettura card' });
    expect(within(panel).getByText(TABLET_TEXT)).toBeInTheDocument();
    expect(await screen.findByText(READY)).toBeInTheDocument();
    expect(readerStatus()).toHaveTextContent(READY);
    // The phone's Web NFC texts are not on the tablet.
    expect(screen.queryByText(PHONE_TITLE)).not.toBeInTheDocument();
  });

  it('puts the search and "Nuovo cliente" side by side in the content, not in a footer', async () => {
    stubLayout(true);
    await renderTablet();
    const field = screen.getByRole('searchbox', { name: 'Oppure cerca per nome o telefono' });
    expect(field).toHaveAttribute('placeholder', 'Es. Rossi o 4521');
    const add = screen.getByRole('link', { name: 'Nuovo cliente' });
    expect(add).toHaveAttribute('href', '/clienti/nuovo');
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(add);
    // The reader column comes first, then the search, then "Nuovo cliente" (wireframe order).
    const panel = screen.getByRole('region', { name: 'Lettura card' });
    expect(panel.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(field.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[data-tablet="true"]')).not.toBeNull();
  });

  it('keeps the full reader column while a search is shown', async () => {
    stubLayout(true);
    await renderTablet();
    const field = screen.getByRole('searchbox', { name: 'Oppure cerca per nome o telefono' });
    await userEvent.type(field, 'rossi');
    expect(
      await screen.findByRole('list', { name: 'Risultati della ricerca' }),
    ).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'Lettura card' });
    expect(within(panel).getByText(TABLET_TITLE)).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('Lettura attiva: puoi anche avvicinare la card');
    expect(field).toHaveAccessibleName('Oppure cerca per nome o telefono');
    expect(readerStatus()).toHaveTextContent(READY);
  });

  it('says "Codice non riconosciuto…" after an invalid read, without leaving the page', async () => {
    stubLayout(true);
    const { router } = await renderTablet();
    await screen.findByText(READY);

    usbBurst('04A1B'); // odd number of hex digits: no uid in the `hex` format

    expect(await screen.findByText(UNRECOGNIZED)).toBeInTheDocument();
    expect(readerStatus()).not.toHaveTextContent(READY);
    expect(router.state.location.pathname).toBe('/');
  });

  it('a known card read by the USB reader opens Registra spesa (criterion 5)', async () => {
    stubLayout(true);
    const { router } = await renderTablet();
    await screen.findByText(READY);

    usbBurst(KNOWN_UID);

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/spesa`));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Registra spesa' }),
    ).toBeInTheDocument();
  });

  it('an unknown card read by the USB reader opens Nuovo cliente with it (criterion 5)', async () => {
    stubLayout(true);
    const { router } = await renderTablet();
    await screen.findByText(READY);

    usbBurst(UNKNOWN_UID);

    await waitFor(() => expect(router.state.location.pathname).toBe('/clienti/nuovo'));
    expect(router.state.location.search).toBe(`?card=${UNKNOWN_UID}`);
  });

  it('keeps the phone home at 390 px: Web NFC texts, no reader indicator, footer action', async () => {
    stubLayout(false);
    await renderTablet(PHONE_TITLE);
    expect(screen.queryByText(TABLET_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText(READY)).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Stato del lettore USB' })).not.toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toContainElement(
      screen.getByRole('link', { name: 'Nuovo cliente' }),
    );
  });
});
