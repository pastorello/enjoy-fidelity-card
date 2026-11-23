import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardWriteResult, CardWriteStep, WriteUrlOptions } from '../card-input/webNfcWriter';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const MARIA = fakeCustomer({ name: 'Maria Rossi', balance: 120 });
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
const MARIA_CARD_ID = '00000000-0000-4000-a000-00000000ca01';
const ONE_CUSTOMER = 'Una card può essere di un solo cliente: usa un’altra card.';
const NOTE = 'La card attuale (…E5F6) verrà disattivata. I punti restano a Maria.';
// Board "Associa-link".
const LINK_NOTE =
  'Con il link, Maria vede i suoi punti avvicinando la card al proprio telefono. Sulla card va solo il link: nessun dato personale.';
const SKIP = 'Salta, lo scrivo più tardi';
const WRITE_AGAIN = 'Scrivi di nuovo il link';
const LINK = /^https?:\/\/[^/]+\/s\/[A-Za-z0-9_-]{22}$/;

/** One `writeUrl` call, ended by the test with `finish`. */
type WriteCall = {
  url: string;
  options: WriteUrlOptions;
  step: (step: CardWriteStep) => void;
  finish: (result: CardWriteResult) => Promise<void>;
};

afterEach(() => {
  vi.restoreAllMocks();
});

function setup({
  auth = signedInFake(),
  writable = true,
  mariaLinkWritten = false,
}: {
  auth?: ReturnType<typeof signedInFake>;
  writable?: boolean;
  mariaLinkWritten?: boolean;
} = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA, GIULIA, ANTONIO, ERASED] });
  const cards = createFakeCardsService({
    customers,
    cards: [
      fakeCard({
        id: MARIA_CARD_ID,
        uid: OF_MARIA.uid,
        customerId: MARIA.id,
        linkWrittenAt: mariaLinkWritten ? '2026-11-17T10:01:00.000Z' : null,
      }),
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
  const card = createTestCardReader({ writable });
  // The link writes are driven by the tests: each `writeUrl` waits for `finish` (or its signal).
  const writes: WriteCall[] = [];
  vi.spyOn(card.reader, 'writeUrl').mockImplementation(
    (url, options) =>
      new Promise<CardWriteResult>((resolve) => {
        writes.push({
          url,
          options,
          step: (step) => act(() => options.onStep?.(step)),
          finish: (result) =>
            act(async () => {
              resolve(result);
              await Promise.resolve();
            }),
        });
        options.signal?.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted' }));
      }),
  );
  return { customers, cards, card, auth, writes };
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

/** The write in progress (the last `writeUrl` call), once it has started. */
async function currentWrite(fixture: Fixture): Promise<WriteCall> {
  await waitFor(() => expect(fixture.writes.length).toBeGreaterThan(0));
  const write = fixture.writes.at(-1);
  if (!write) throw new Error('no write');
  return write;
}

function writer() {
  return screen.getByRole('region', { name: 'Scrittura del link' });
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
    const write = await currentWrite(fixture);
    await write.finish({ ok: true });

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(associations(fixture)).toEqual([[MARIA.id, NEW_ONE.uid]]);
    await expectConfirmation('Card …0001 associata');
    expect(screen.getByRole('status')).not.toHaveTextContent('Link non scritto');
    expect(cardOf(fixture, NEW_ONE.uid)).toMatchObject({ active: true, linkState: 'written' });
    expect(cardOf(fixture, OF_MARIA.uid)).toMatchObject({ active: false });
    expect(cardOf(fixture, OF_MARIA.uid)?.deactivatedAt).not.toBeNull();
  });

  it('a first card for a customer without one', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture, GIULIA.id);
    tap(fixture, NEW_ONE.read);
    await userEvent.click(await screen.findByRole('button', { name: SKIP }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${GIULIA.id}`));
    await expectConfirmation('Card …0001 associata. Link non scritto.');
  });

  it('the customer’s own deactivated card is reactivated, with the outcome of a success', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture);
    tap(fixture, LOST.read);
    const write = await currentWrite(fixture);
    // The old link died with the deactivation: a new one is written on that card.
    expect(write.options.expectedUid).toBe(LOST.uid);
    await write.finish({ ok: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    await expectConfirmation('Card …5566 associata');
    expect(cardOf(fixture, LOST.uid)?.active).toBe(true);
    expect(cardOf(fixture, OF_MARIA.uid)?.active).toBe(false);
  });

  it('the card already active for this customer, link not written: said, and the link is written at once', async () => {
    const fixture = setup();
    const before = cardOf(fixture, OF_MARIA.uid);
    const { router } = await renderReading(fixture);
    tap(fixture, OF_MARIA.read);

    expect(await screen.findByText('Questa è già la card attiva di Maria.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/card`);
    // The association changed nothing.
    expect(cardOf(fixture, OF_MARIA.uid)).toMatchObject({
      active: true,
      associatedAt: before?.associatedAt,
      deactivatedAt: null,
    });
    // The note about replacing it would be wrong now.
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();

    const write = await currentWrite(fixture);
    expect(fixture.cards.service.issueLink).toHaveBeenCalledExactlyOnceWith(MARIA_CARD_ID);
    expect(write.options.expectedUid).toBe(OF_MARIA.uid);
    expect(writer()).toBeInTheDocument();
    // Reads are off while the link is written.
    tap(fixture, NEW_ONE.read);
    expect(associations(fixture)).toEqual([[MARIA.id, OF_MARIA.uid]]);
    await write.finish({ ok: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    await expectConfirmation('Card …E5F6 associata');
  });

  it('the card already active with the link written: «Scrivi di nuovo il link» under the message', async () => {
    const fixture = setup({ mariaLinkWritten: true });
    const { router } = await renderReading(fixture);
    tap(fixture, OF_MARIA.read);

    const message = await screen.findByText('Questa è già la card attiva di Maria.');
    const again = screen.getByRole('button', { name: WRITE_AGAIN });
    expect(message.compareDocumentPosition(again) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fixture.cards.service.issueLink).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Scrittura del link' })).not.toBeInTheDocument();

    await userEvent.click(again);
    const write = await currentWrite(fixture);
    expect(write.options.expectedUid).toBe(OF_MARIA.uid);
    expect(write.url).toMatch(LINK);
    await write.finish({ ok: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    await expectConfirmation('Card …E5F6 associata');
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
    expect(await screen.findByText('Card associata a Maria')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/card`);
    expect(associations(fixture)).toEqual([
      [MARIA.id, OF_ANTONIO.uid],
      [MARIA.id, NEW_TWO.uid],
    ]);
  });

  it('«Riprova con un’altra card»: the notice unmounts, the focus goes to the reading panel', async () => {
    const fixture = setup();
    await renderReading(fixture);
    tap(fixture, OF_ANTONIO.read);
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Riprova con un’altra card' }));
    const panel = await screen.findByRole('region', { name: 'Lettura card' });
    expect(document.activeElement).not.toBe(document.body);
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toHaveTextContent(PANEL_TEXT);
  });

  it('"Apri la scheda di Antonio" opens his customer page', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture);
    tap(fixture, OF_ANTONIO.read);
    const open = await screen.findByRole('link', { name: 'Apri la scheda di Antonio' });
    // One flex item: the button's gap never adds to the space before the name.
    expect(open.childNodes).toHaveLength(1);
    expect(open).toHaveTextContent(/^Apri la scheda di Antonio$/);
    await userEvent.click(open);
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
    expect(await screen.findByText('Card associata a Maria')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/card`);
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
    await userEvent.click(await screen.findByRole('button', { name: SKIP }));

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

describe('AssociateCardPage: the link after the association (boards "Associa-link", "Associa-link-errore")', () => {
  it('«Card associata a Maria», the write and the note of the board; the link holds a token, never the uid (criterion 10)', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture);
    tap(fixture, NEW_ONE.read);

    const status = await screen.findByText('Card associata a Maria');
    // An `output`: a live status, as the board's `role="status"`.
    expect(status.closest('output')).not.toBeNull();
    // Panel, replacement note and "Annulla" give way to the write.
    expect(screen.queryByRole('region', { name: 'Lettura card' })).not.toBeInTheDocument();
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Annulla' })).not.toBeInTheDocument();
    // Every way out after the association goes to the customer page.
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}`,
    );

    const write = await currentWrite(fixture);
    expect(writer()).toHaveTextContent('Tieni la card appoggiata');
    expect(writer()).toHaveTextContent('Scrivo il link per vedere i punti…');
    const note = screen.getByText(LINK_NOTE);
    expect(
      status.compareDocumentPosition(writer()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(writer().compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: SKIP })).toBeInTheDocument();

    expect(write.url).toMatch(LINK);
    expect(write.url).not.toContain(NEW_ONE.uid);
    expect(write.url.toUpperCase()).not.toContain(NEW_ONE.uid);
    expect(write.options.expectedUid).toBe(NEW_ONE.uid);
    const token = await fixture.cards.service.issueLink.mock.results[0]?.value;
    expect(write.url.endsWith(`/s/${String(token)}`)).toBe(true);
    // The token is never on screen.
    expect(document.body.innerHTML).not.toContain(String(token));

    await write.finish({ ok: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(fixture.cards.service.confirmLink).toHaveBeenCalledOnce();
  });

  it('reads are ignored while the link is written', async () => {
    const fixture = setup();
    await renderReading(fixture);
    tap(fixture, NEW_ONE.read);
    await currentWrite(fixture);
    tap(fixture, NEW_TWO.read);
    expect(associations(fixture)).toEqual([[MARIA.id, NEW_ONE.uid]]);
  });

  it('«Salta, lo scrivo più tardi»: the customer page with «Link non scritto.»', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture);
    tap(fixture, NEW_ONE.read);
    const write = await currentWrite(fixture);
    await userEvent.click(screen.getByRole('button', { name: SKIP }));
    expect(write.options.signal?.aborted).toBe(true);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
    await expectConfirmation('Card …0001 associata. Link non scritto.');
    expect(fixture.cards.service.confirmLink).not.toHaveBeenCalled();
    // The association stays.
    expect(cardOf(fixture, NEW_ONE.uid)).toMatchObject({ active: true, linkState: 'not-written' });
  });

  it('the card moved away too early: the texts of "Associa-link-errore", then «Più tardi»', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture);
    tap(fixture, NEW_ONE.read);
    const write = await currentWrite(fixture);
    await write.finish({ ok: false, reason: 'io' });

    const alert = await screen.findByRole('alert', { name: 'Link non scritto' });
    expect(alert).toHaveTextContent(
      'La card è associata a Maria e funziona alla cassa. Il link per vedere i punti non è stato scritto: la card si è staccata troppo presto.',
    );
    expect(screen.getByText('Puoi scriverlo anche dopo, da Modifica cliente.')).toBeInTheDocument();
    // As in the board: neither the confirmation nor the note on the link.
    expect(screen.queryByText('Card associata a Maria')).not.toBeInTheDocument();
    expect(screen.queryByText(LINK_NOTE)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: WRITE_AGAIN })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Più tardi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    await expectConfirmation('Card …0001 associata. Link non scritto.');
  });

  it('«Scrivi di nuovo il link» after a failure writes from a new token; written → the customer page', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture);
    tap(fixture, NEW_ONE.read);
    await (await currentWrite(fixture)).finish({ ok: false, reason: 'timeout' });
    await userEvent.click(await screen.findByRole('button', { name: WRITE_AGAIN }));

    await waitFor(() => expect(fixture.writes).toHaveLength(2));
    expect(fixture.cards.service.issueLink).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Card associata a Maria')).toBeInTheDocument();
    await fixture.writes[1]?.finish({ ok: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    await expectConfirmation('Card …0001 associata');
  });

  it('a phone that does not write: the association is saved, the customer page with «Link non scritto.» (criterion 13)', async () => {
    const fixture = setup({ writable: false });
    const { router } = await renderReading(fixture);
    tap(fixture, NEW_ONE.read);

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
    await expectConfirmation('Card …0001 associata. Link non scritto.');
    expect(cardOf(fixture, NEW_ONE.uid)?.active).toBe(true);
    expect(fixture.cards.service.issueLink).not.toHaveBeenCalled();
    expect(fixture.writes).toHaveLength(0);
  });

  it('the phone stops writing during the write (cannot-write): the outcome of «Più tardi»', async () => {
    const fixture = setup();
    const { router } = await renderReading(fixture);
    tap(fixture, NEW_ONE.read);
    await (await currentWrite(fixture)).finish({ ok: false, reason: 'cannot-write' });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    await expectConfirmation('Card …0001 associata. Link non scritto.');
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
