import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import type { CardWriteResult, WriteUrlOptions } from '../card-input/webNfcWriter';
import type { CardSummary, LinkState } from './types';

const MARIA = fakeCustomer({ name: 'Maria Rossi' });
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

/** One `writeUrl` call, ended by the test with `finish`. */
type WriteCall = {
  url: string;
  options: WriteUrlOptions;
  finish: (result: CardWriteResult) => Promise<void>;
};

const WRITTEN = 'Link ai punti scritto';
const NOT_WRITTEN = 'Link non scritto: il cliente non può ancora vedere i suoi punti con la card.';
const UNVERIFIED =
  'Link da controllare: l’ultima scrittura non è stata verificata, la card potrebbe non mostrare i punti.';
const DEVICE = 'Per scrivere il link serve un telefono Android con l’NFC attivo.';
const WRITE = 'Scrivi il link';
const WRITE_AGAIN = 'Scrivi di nuovo il link';

/** Maria's card with the link in `state`, and a card reader whose writes the test ends. */
function setupLink(state: LinkState, { writable = true } = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA] });
  const instants: Record<LinkState, Pick<CardSummary, 'linkWrittenAt' | 'linkPendingAt'>> = {
    'not-written': { linkWrittenAt: null, linkPendingAt: null },
    written: { linkWrittenAt: '2026-11-17T10:01:00.000Z', linkPendingAt: null },
    unverified: {
      linkWrittenAt: '2026-11-17T10:01:00.000Z',
      linkPendingAt: '2026-11-17T11:00:00.000Z',
    },
  };
  const cards = createFakeCardsService({
    customers,
    cards: [fakeCard({ uid: UID, customerId: MARIA.id, associatedAt: SINCE, ...instants[state] })],
  });
  const card = createTestCardReader({ writable });
  const writes: WriteCall[] = [];
  vi.spyOn(card.reader, 'writeUrl').mockImplementation(
    (url, options) =>
      new Promise<CardWriteResult>((resolve) => {
        writes.push({
          url,
          options,
          finish: (result) =>
            act(async () => {
              resolve(result);
              await Promise.resolve();
            }),
        });
        options.signal?.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted' }));
      }),
  );
  return { customers, cards, card, writes };
}

type LinkFixture = ReturnType<typeof setupLink>;

function renderLink(fixture: LinkFixture) {
  return renderApp(
    `/clienti/${MARIA.id}/modifica`,
    signedInFake(),
    createFakeSettingsService(),
    fixture.customers,
    createFakeRewardsService(),
    fixture.card,
    fixture.cards,
  );
}

async function currentWrite(fixture: LinkFixture): Promise<WriteCall> {
  await waitFor(() => expect(fixture.writes.length).toBeGreaterThan(0));
  const write = fixture.writes.at(-1);
  if (!write) throw new Error('no write');
  return write;
}

describe('CustomerCardSection: the link to the points (SPEC-cards, point 5; criteria 13, 15)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('written: «Link ai punti scritto» and the secondary "Scrivi di nuovo il link"', async () => {
    renderLink(setupLink('written'));
    const section = await cardSection();
    expect(await within(section).findByText(WRITTEN)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: WRITE_AGAIN })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
    expect(within(section).queryByRole('button', { name: WRITE })).toBeNull();
    expect(section).not.toHaveTextContent(NOT_WRITTEN);
  });

  it('not written: the warning and "Scrivi il link"', async () => {
    renderLink(setupLink('not-written'));
    const section = await cardSection();
    expect(await within(section).findByText(NOT_WRITTEN)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: WRITE })).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: WRITE_AGAIN })).toBeNull();
    expect(section).not.toHaveTextContent(WRITTEN);
  });

  it('unverified: «Link da controllare…» and "Scrivi di nuovo il link"', async () => {
    renderLink(setupLink('unverified'));
    const section = await cardSection();
    expect(await within(section).findByText(UNVERIFIED)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: WRITE_AGAIN })).toBeInTheDocument();
    expect(section).not.toHaveTextContent(WRITTEN);
  });

  it.each<LinkState>(['written', 'not-written', 'unverified'])(
    'a phone that does not write (%s): no button, the device text in its place (criterion 13)',
    async (state) => {
      renderLink(setupLink(state, { writable: false }));
      const section = await cardSection();
      expect(await within(section).findByText(DEVICE)).toBeInTheDocument();
      expect(within(section).queryByRole('button', { name: WRITE })).toBeNull();
      expect(within(section).queryByRole('button', { name: WRITE_AGAIN })).toBeNull();
      // The card buttons stay.
      expect(within(section).getByRole('button', { name: 'Disattiva card' })).toBeInTheDocument();
    },
  );

  it('nothing is written until "Scrivi il link" is tapped', async () => {
    const fixture = setupLink('not-written');
    renderLink(fixture);
    const section = await cardSection();
    await within(section).findByText(NOT_WRITTEN);
    expect(fixture.writes).toHaveLength(0);
    expect(fixture.cards.calls.some((call) => call.method === 'issueLink')).toBe(false);
  });

  it('"Scrivi il link": the write opens in the section on the card, then the section reloads as written (criterion 13)', async () => {
    const fixture = setupLink('not-written');
    renderLink(fixture);
    const section = await cardSection();
    await userEvent.click(await within(section).findByRole('button', { name: WRITE }));

    const write = await currentWrite(fixture);
    expect(write.options.expectedUid).toBe(UID);
    expect(write.url).toMatch(/^https?:\/\/[^/]+\/s\/[A-Za-z0-9_-]{22}$/);
    act(() => write.options.onStep?.('waiting-card'));
    const writer = within(section).getByRole('region', { name: 'Scrittura del link' });
    expect(writer).toHaveTextContent('Avvicina la card …E5F6');
    expect(
      within(section).getByRole('button', { name: 'Salta, lo scrivo più tardi' }),
    ).toBeInTheDocument();

    await write.finish({ ok: true });
    expect(await within(section).findByText(WRITTEN)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: WRITE_AGAIN })).toBeInTheDocument();
    expect(within(section).queryByRole('region', { name: 'Scrittura del link' })).toBeNull();
    expect(fixture.cards.cards()[0]?.linkState).toBe('written');
    // The token is never on screen.
    const token = write.url.split('/s/')[1] ?? '';
    expect(document.body).not.toHaveTextContent(token);
  });

  it('"Scrivi il link": the button unmounts, the focus goes to the write, never to the page', async () => {
    const fixture = setupLink('not-written');
    renderLink(fixture);
    const section = await cardSection();
    await userEvent.click(await within(section).findByRole('button', { name: WRITE }));
    await currentWrite(fixture);
    const writer = within(section).getByRole('region', { name: 'Scrittura del link' });
    expect(document.activeElement).not.toBe(document.body);
    expect(writer.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toHaveAttribute('aria-live', 'polite');
  });

  it('a write that fails, then «Più tardi», leaves the link unverified, never written (criterion 15)', async () => {
    const fixture = setupLink('written');
    renderLink(fixture);
    const section = await cardSection();
    await userEvent.click(await within(section).findByRole('button', { name: WRITE_AGAIN }));
    const write = await currentWrite(fixture);
    await write.finish({ ok: false, reason: 'verify-failed' });

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Il link sulla card non risulta giusto. Riprova.',
    );
    await userEvent.click(within(section).getByRole('button', { name: 'Più tardi' }));
    expect(await within(section).findByText(UNVERIFIED)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: WRITE_AGAIN })).toBeInTheDocument();
    expect(fixture.cards.calls.some((call) => call.method === 'confirmLink')).toBe(false);
  });

  it('«Salta, lo scrivo più tardi» stops the write and reloads the section', async () => {
    const fixture = setupLink('not-written');
    renderLink(fixture);
    const section = await cardSection();
    await userEvent.click(await within(section).findByRole('button', { name: WRITE }));
    const write = await currentWrite(fixture);
    await userEvent.click(
      within(section).getByRole('button', { name: 'Salta, lo scrivo più tardi' }),
    );
    expect(write.options.signal?.aborted).toBe(true);
    expect(await within(section).findByText(NOT_WRITTEN)).toBeInTheDocument();
    expect(within(section).queryByRole('region', { name: 'Scrittura del link' })).toBeNull();
  });
});
