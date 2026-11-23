import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InitialEntry } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestCardReader } from '../../test/fakeCardReader';
import { driveLinkWrites, type LinkWriteCall } from '../../test/fakeLinkWrites';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { CardTakenError } from './types';

const NAME = 'Nome e cognome';
const EMAIL = 'Email (facoltativa)';
const CONSENT = /Ha letto l’informativa privacy/;
const SECTION_TEXT =
  'Lettura attiva: avvicina una card nuova per associarla adesso, oppure fallo più tardi dalla scheda.';
const ONE_CUSTOMER = 'Una card può essere di un solo cliente: usa un’altra card.';

const MARIA = fakeCustomer({ name: 'Maria Rossi', email: 'maria@example.com', balance: 120 });
const ERASED = fakeCustomer({ name: 'cancellato-7f3a', anonymizedAt: '2026-11-17T09:00:00.000Z' });

/** Uids as Web NFC gives them, and as the app keeps them. Invented. */
const NEW_ONE = { read: '04:de:ad:be:ef:00:01', uid: '04DEADBEEF0001' };
const NEW_TWO = { read: '04:de:ad:be:ef:00:02', uid: '04DEADBEEF0002' };
const OF_MARIA = { read: '04:a1:b2:c3:d4:e5:f6', uid: '04A1B2C3D4E5F6' };
const LOST = { read: '04:11:22:33:44:55:66', uid: '04112233445566' };
const OF_ERASED = { read: '04:77:88:99:aa:bb:cc', uid: '04778899AABBCC' };

function setup({
  card = createTestCardReader(),
  auth = signedInFake(),
}: {
  card?: ReturnType<typeof createTestCardReader>;
  auth?: ReturnType<typeof signedInFake>;
} = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA, ERASED] });
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
      fakeCard({ uid: OF_ERASED.uid, customerId: ERASED.id, active: false }),
    ],
  });
  return { customers, cards, card, auth };
}

type Fixture = ReturnType<typeof setup>;

/** A fixture whose link writes wait for the test (`writes`). */
function writeSetup(options: Parameters<typeof setup>[0] = {}) {
  const fixture = setup(options);
  return { ...fixture, writes: driveLinkWrites(fixture.card.reader) };
}

type WriteFixture = ReturnType<typeof writeSetup>;

/** The write of the link in progress (the last `writeUrl` call), once it has started. */
async function currentWrite(fixture: WriteFixture): Promise<LinkWriteCall> {
  await waitFor(() => expect(fixture.writes.length).toBeGreaterThan(0));
  const write = fixture.writes.at(-1);
  if (!write) throw new Error('no write');
  return write;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Nuovo cliente opened by the home after an unknown card (the uid in the history state). */
function fromHome(uid: string): InitialEntry {
  return { pathname: '/clienti/nuovo', state: { card: uid } };
}

async function renderNew(fixture: Fixture = setup(), path: InitialEntry = '/clienti/nuovo') {
  const rendered = renderApp(
    path,
    fixture.auth,
    createFakeSettingsService(),
    fixture.customers,
    createFakeRewardsService(),
    fixture.card,
    fixture.cards,
  );
  await screen.findByRole('textbox', { name: NAME });
  return rendered;
}

/** The section once reading is on. */
async function activeSection() {
  const section = await screen.findByRole('region', { name: 'Card' });
  await within(section).findByText(SECTION_TEXT);
  return section;
}

function tap(fixture: Fixture, read: string) {
  act(() => {
    fixture.card.nfc.read(read);
  });
}

async function fillValid(name = 'Giulia Bianchi', email = 'giulia@example.com') {
  await userEvent.type(screen.getByRole('textbox', { name: NAME }), name);
  if (email !== '') await userEvent.type(screen.getByRole('textbox', { name: EMAIL }), email);
  await userEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: /^(Salva cliente|Riprova)$/ }));
}

function lookups(fixture: Fixture) {
  return fixture.cards.calls.filter((call) => call.method === 'lookup').map((call) => call.args);
}

function newCustomers(fixture: Fixture) {
  return fixture.customers.customers().filter((c) => c.id !== MARIA.id && c.id !== ERASED.id);
}

describe('Nuovo cliente senza card: the section "Card (facoltativa)"', () => {
  it('shows the section after the form, with the texts of the wireframe', async () => {
    await renderNew();
    const section = await activeSection();
    expect(section).toHaveTextContent('Card (facoltativa)');
    // After PRIVACY, as in the wireframe.
    const consent = screen.getByRole('checkbox', { name: CONSENT });
    expect(
      consent.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
  });

  it('an unknown card becomes "Card letta", saved with the customer; its link, then the customer page', async () => {
    const fixture = writeSetup();
    const { router } = await renderNew(fixture);
    await activeSection();
    await fillValid();
    tap(fixture, NEW_ONE.read);

    const panel = await screen.findByRole('region', { name: 'Card letta' });
    expect(panel).toHaveTextContent(
      `Codice ${NEW_ONE.uid}: non è di nessun cliente, verrà associata a questo.`,
    );
    expect(screen.queryByRole('region', { name: 'Card' })).not.toBeInTheDocument();
    expect(lookups(fixture)).toEqual([[NEW_ONE.uid]]);
    // The data typed stay.
    expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Giulia Bianchi');

    save();
    const [saved] = await waitFor(() => {
      const created = newCustomers(fixture);
      expect(created).toHaveLength(1);
      return created;
    });
    await (await currentWrite(fixture)).finish({ ok: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved?.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fixture.customers.service.create).not.toHaveBeenCalled();
    expect(fixture.cards.service.createCustomerWithCard.mock.calls[0]?.[0]).toMatchObject({
      uid: NEW_ONE.uid,
      name: 'Giulia Bianchi',
      privacyConsent: true,
    });
    expect(fixture.cards.cards()).toContainEqual(
      expect.objectContaining({ uid: NEW_ONE.uid, customerId: saved?.id, active: true }),
    );
  });

  it('a second unknown card replaces the first: the last one read is saved', async () => {
    const fixture = writeSetup();
    await renderNew(fixture);
    await activeSection();
    tap(fixture, NEW_ONE.read);
    await screen.findByText(new RegExp(`Codice ${NEW_ONE.uid}`));
    tap(fixture, NEW_TWO.read);
    await screen.findByText(new RegExp(`Codice ${NEW_TWO.uid}`));
    expect(screen.queryByText(new RegExp(`Codice ${NEW_ONE.uid}`))).not.toBeInTheDocument();

    await fillValid();
    save();
    await waitFor(() =>
      expect(fixture.cards.service.createCustomerWithCard).toHaveBeenCalledTimes(1),
    );
    expect(fixture.cards.service.createCustomerWithCard.mock.calls[0]?.[0].uid).toBe(NEW_TWO.uid);
  });

  it('says "Lettura della card…" while looking up, and ignores other reads meanwhile', async () => {
    const fixture = setup();
    await renderNew(fixture);
    const section = await activeSection();
    const hold = fixture.cards.holdNext('lookup');
    tap(fixture, NEW_ONE.read);
    expect(await within(section).findByText('Lettura della card…')).toBeVisible();
    tap(fixture, NEW_TWO.read);
    await act(async () => hold.release());

    await screen.findByText(new RegExp(`Codice ${NEW_ONE.uid}`));
    expect(lookups(fixture)).toEqual([[NEW_ONE.uid]]);
  });

  describe('a card already known (criterion 5)', () => {
    it('an active card: "Card già associata" with the owner, the data intact, saved without a card', async () => {
      const fixture = setup();
      const { router } = await renderNew(fixture);
      await activeSection();
      await fillValid();
      tap(fixture, OF_MARIA.read);

      const notice = await screen.findByRole('alert');
      expect(within(notice).getByRole('heading', { name: 'Card già associata' })).toBeVisible();
      expect(notice).toHaveTextContent(`Questa card è di Maria Rossi. ${ONE_CUSTOMER}`);
      expect(within(notice).getByRole('link', { name: 'Apri la scheda di Maria' })).toHaveAttribute(
        'href',
        `/clienti/${MARIA.id}`,
      );
      expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Giulia Bianchi');
      expect(screen.getByRole('textbox', { name: EMAIL })).toHaveValue('giulia@example.com');
      expect(screen.getByRole('checkbox', { name: CONSENT })).toBeChecked();
      expect(router.state.location.pathname).toBe('/clienti/nuovo');

      save();
      await waitFor(() => expect(newCustomers(fixture)).toHaveLength(1));
      expect(fixture.cards.service.createCustomerWithCard).not.toHaveBeenCalled();
      expect(fixture.customers.service.create).toHaveBeenCalledTimes(1);
    });

    it('a known card after an unknown one drops it: the customer is saved without a card', async () => {
      const fixture = setup();
      await renderNew(fixture);
      await activeSection();
      tap(fixture, NEW_ONE.read);
      await screen.findByRole('region', { name: 'Card letta' });
      tap(fixture, OF_MARIA.read);
      await screen.findByRole('alert');
      expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();

      await fillValid();
      save();
      await waitFor(() => expect(newCustomers(fixture)).toHaveLength(1));
      expect(fixture.cards.service.createCustomerWithCard).not.toHaveBeenCalled();
    });

    it('a deactivated card says "era di"', async () => {
      const fixture = setup();
      await renderNew(fixture);
      await activeSection();
      tap(fixture, LOST.read);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        `Questa card era di Maria Rossi. ${ONE_CUSTOMER}`,
      );
    });

    it('a card of an erased customer: no name, no "Apri la scheda"', async () => {
      const fixture = setup();
      await renderNew(fixture);
      await activeSection();
      tap(fixture, OF_ERASED.read);
      const notice = await screen.findByRole('alert');
      expect(notice).toHaveTextContent(
        `Questa card era di un cliente i cui dati sono stati cancellati. ${ONE_CUSTOMER}`,
      );
      expect(notice).not.toHaveTextContent('cancellato-7f3a');
      expect(within(notice).queryByRole('link')).not.toBeInTheDocument();
    });

    it('reading stays on: an unknown card replaces the notice', async () => {
      const fixture = setup();
      await renderNew(fixture);
      await activeSection();
      tap(fixture, OF_MARIA.read);
      await screen.findByRole('alert');
      tap(fixture, NEW_ONE.read);
      await screen.findByRole('region', { name: 'Card letta' });
      expect(screen.queryByRole('heading', { name: 'Card già associata' })).not.toBeInTheDocument();
    });
  });

  it('a lookup without answer: "Card non letta" and "Riprova" looks the same card up again', async () => {
    const fixture = setup();
    await renderNew(fixture);
    const section = await activeSection();
    fixture.cards.failNext('lookup', 'lost');
    tap(fixture, NEW_ONE.read);
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent('Card non letta: controlla la connessione.');
    fireEvent.click(within(section).getByRole('button', { name: 'Riprova' }));

    await screen.findByRole('region', { name: 'Card letta' });
    expect(lookups(fixture)).toEqual([[NEW_ONE.uid], [NEW_ONE.uid]]);
  });

  it('a lookup without answer after a known card: the error replaces the notice', async () => {
    const fixture = setup();
    await renderNew(fixture);
    await activeSection();
    tap(fixture, OF_MARIA.read);
    await screen.findByRole('heading', { name: 'Card già associata' });
    fixture.cards.failNext('lookup', 'lost');
    tap(fixture, NEW_ONE.read);
    const section = await screen.findByRole('region', { name: 'Card' });
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Card non letta: controlla la connessione.',
    );
    expect(screen.queryByRole('heading', { name: 'Card già associata' })).not.toBeInTheDocument();
  });

  it('card taken meanwhile: no customer, the notice, then saved without the card', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture);
    await activeSection();
    await fillValid();
    tap(fixture, NEW_ONE.read);
    await screen.findByRole('region', { name: 'Card letta' });
    fixture.cards.failNext(
      'createCustomerWithCard',
      new CardTakenError({ customerId: MARIA.id, name: 'Maria Rossi', active: true }),
    );
    save();

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(`Questa card è di Maria Rossi. ${ONE_CUSTOMER}`);
    expect(newCustomers(fixture)).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Giulia Bianchi');

    save();
    const [saved] = await waitFor(() => {
      const created = newCustomers(fixture);
      expect(created).toHaveLength(1);
      return created;
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved?.id}`));
    // Nothing was created by the refused send: the same operation_id is reused.
    expect(fixture.customers.service.create.mock.calls[0]?.[0].operationId).toBe(
      fixture.cards.service.createCustomerWithCard.mock.calls[0]?.[0].operationId,
    );
  });

  it('not_operator on the lookup: back to /accedi', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture);
    await activeSection();
    fixture.cards.failNext('lookup', 'not_operator');
    const held = fixture.cards.holdNext('lookup');
    tap(fixture, NEW_ONE.read);
    fixture.auth.removeProfile();
    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });

  describe('reading not available: the customer is saved without a card', () => {
    it('iPhone (no Web NFC): "Lettura card spenta", saved with create', async () => {
      const fixture = setup({ card: createTestCardReader({ supported: false }) });
      const { router } = await renderNew(fixture);
      const section = await screen.findByRole('region', { name: 'Card' });
      expect(await within(section).findByText('Lettura card spenta')).toBeVisible();
      expect(section).toHaveTextContent('Su iPhone le card non si leggono');

      await fillValid();
      save();
      const [saved] = await waitFor(() => {
        const created = newCustomers(fixture);
        expect(created).toHaveLength(1);
        return created;
      });
      await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved?.id}`));
      expect(fixture.cards.service.createCustomerWithCard).not.toHaveBeenCalled();
    });

    it('NFC off: "Riprova la lettura" in the section, saved with create', async () => {
      const fixture = setup({
        card: createTestCardReader({ scanOutcomes: ['NotReadableError'] }),
      });
      await renderNew(fixture);
      const section = await screen.findByRole('region', { name: 'Card' });
      expect(await within(section).findByText('Lettura card spenta')).toBeVisible();
      expect(within(section).getByRole('button', { name: 'Riprova la lettura' })).toBeVisible();

      await fillValid();
      save();
      await waitFor(() => expect(newCustomers(fixture)).toHaveLength(1));
      expect(fixture.cards.service.createCustomerWithCard).not.toHaveBeenCalled();
    });

    it('the permission to ask: "Attiva la lettura" in the section', async () => {
      const fixture = setup({ card: createTestCardReader({ permission: 'prompt' }) });
      await renderNew(fixture);
      const section = await screen.findByRole('region', { name: 'Card' });
      expect(
        await within(section).findByRole('button', { name: 'Attiva la lettura' }),
      ).toBeVisible();
    });
  });

  it('from the home (card in the history state): an unknown card read replaces the card of the link', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture, fromHome(NEW_ONE.uid));
    await screen.findByText(new RegExp(`Codice ${NEW_ONE.uid}`));
    tap(fixture, NEW_TWO.read);
    await screen.findByText(new RegExp(`Codice ${NEW_TWO.uid}`));
    expect(router.state.location.state).toEqual({ card: NEW_TWO.uid });
    expect(router.state.location.search).toBe('');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('from the home (card in the history state): a lookup without answer is said under the form, the card kept', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture, fromHome(NEW_ONE.uid));
    await screen.findByText(new RegExp(`Codice ${NEW_ONE.uid}`));
    fixture.cards.failNext('lookup', 'lost');
    tap(fixture, NEW_TWO.read);
    const section = await screen.findByRole('region', { name: 'Card' });
    expect(await within(section).findByRole('alert')).toHaveTextContent('Card non letta');
    expect(screen.getByRole('region', { name: 'Card letta' })).toHaveTextContent(NEW_ONE.uid);
    expect(router.state.location.state).toEqual({ card: NEW_ONE.uid });
  });

  it('from the home (card in the history state): a known card read drops the card of the link', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture, fromHome(NEW_ONE.uid));
    await screen.findByText(new RegExp(`Codice ${NEW_ONE.uid}`));
    tap(fixture, OF_MARIA.read);
    expect(await screen.findByRole('alert')).toHaveTextContent('Questa card è di Maria Rossi.');
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(router.state.location.search).toBe('');
    expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
  });
});

function writer() {
  return screen.getByRole('region', { name: 'Scrittura del link' });
}

/** Nuovo cliente senza card: fills the form, reads an unknown card and saves. */
async function saveWithReadCard(fixture: WriteFixture) {
  const rendered = await renderNew(fixture);
  await activeSection();
  await fillValid();
  tap(fixture, NEW_ONE.read);
  await screen.findByRole('region', { name: 'Card letta' });
  save();
  const [saved] = await waitFor(() => {
    const created = newCustomers(fixture);
    expect(created).toHaveLength(1);
    return created;
  });
  if (!saved) throw new Error('no customer');
  return { ...rendered, saved };
}

/** Nuovo cliente da card nuova (from the home): fills the form and saves. */
async function saveFromLink(fixture: WriteFixture) {
  const rendered = await renderNew(fixture, fromHome(NEW_ONE.uid));
  await fillValid();
  save();
  const [saved] = await waitFor(() => {
    const created = newCustomers(fixture);
    expect(created).toHaveLength(1);
    return created;
  });
  if (!saved) throw new Error('no customer');
  return { ...rendered, saved };
}

/** «Card non associata» for NEW_TWO, still on Nuovo cliente. */
async function noticeOf(router: Awaited<ReturnType<typeof renderNew>>['router']) {
  const notice = await screen.findByRole('alert', { name: 'Card non associata' });
  expect(notice).toHaveTextContent(
    `La card …${NEW_TWO.uid.slice(-4)} non è associata a Giulia: il cliente era già stato salvato. Associala dalla scheda.`,
  );
  // Still here: the operator must know before handing the card over.
  expect(router.state.location.pathname).toBe('/clienti/nuovo');
  return notice;
}

describe('Nuovo cliente: the link written after the save (SPEC-cards, points 2, 3 and 8)', () => {
  const SKIP = 'Salta, lo scrivo più tardi';
  const LINK = /^https?:\/\/[^/]+\/s\/[A-Za-z0-9_-]{22}$/;
  const LINK_NOTE =
    'Con il link, Giulia vede i suoi punti avvicinando la card al proprio telefono. Sulla card va solo il link: nessun dato personale.';

  it('read on the page: «Card associata a Giulia», the write on that card, then the customer page', async () => {
    const fixture = writeSetup();
    const { router, saved } = await saveWithReadCard(fixture);

    const status = await screen.findByText('Card associata a Giulia');
    expect(status.closest('output')).not.toBeNull();
    const write = await currentWrite(fixture);
    expect(writer()).toHaveTextContent('Tieni la card appoggiata');
    expect(screen.getByText(LINK_NOTE)).toBeInTheDocument();
    // The form is gone: the customer is saved, only the link is left.
    expect(screen.queryByRole('textbox', { name: NAME })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salva cliente' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: SKIP })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute(
      'href',
      `/clienti/${saved.id}`,
    );
    // Still on Nuovo cliente until the write ends.
    expect(router.state.location.pathname).toBe('/clienti/nuovo');

    // Only the link, with a token: never the uid.
    expect(write.options.expectedUid).toBe(NEW_ONE.uid);
    expect(write.url).toMatch(LINK);
    expect(write.url.toUpperCase()).not.toContain(NEW_ONE.uid);
    const token = await fixture.cards.service.issueLink.mock.results[0]?.value;
    expect(document.body.innerHTML).not.toContain(String(token));

    await write.finish({ ok: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fixture.cards.service.confirmLink).toHaveBeenCalledOnce();
    expect(fixture.cards.cards()).toContainEqual(
      expect.objectContaining({ uid: NEW_ONE.uid, customerId: saved.id, linkState: 'written' }),
    );
  });

  it('from the home: the write, then Registra spesa in place of the form', async () => {
    const fixture = writeSetup();
    const { router, saved } = await saveFromLink(fixture);
    const write = await currentWrite(fixture);
    expect(write.options.expectedUid).toBe(NEW_ONE.uid);
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute(
      'href',
      `/clienti/${saved.id}/spesa`,
    );
    await write.finish({ ok: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved.id}/spesa`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fixture.cards.service.confirmLink).toHaveBeenCalledOnce();
  });

  it('from the home, «Salta, lo scrivo più tardi»: Registra spesa, customer and card saved without the link', async () => {
    const fixture = writeSetup();
    const { router, saved } = await saveFromLink(fixture);
    const write = await currentWrite(fixture);
    await userEvent.click(screen.getByRole('button', { name: SKIP }));
    expect(write.options.signal?.aborted).toBe(true);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved.id}/spesa`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fixture.cards.service.confirmLink).not.toHaveBeenCalled();
    expect(fixture.cards.cards()).toContainEqual(
      expect.objectContaining({
        uid: NEW_ONE.uid,
        customerId: saved.id,
        active: true,
        linkState: 'not-written',
      }),
    );
  });

  it('the card moved away too early (io): the alert of the board, then «Più tardi» opens the destination', async () => {
    const fixture = writeSetup();
    const { router, saved } = await saveWithReadCard(fixture);
    await (await currentWrite(fixture)).finish({ ok: false, reason: 'io' });

    const alert = await screen.findByRole('alert', { name: 'Link non scritto' });
    expect(alert).toHaveTextContent('La card è associata a Giulia e funziona alla cassa.');
    expect(screen.getByRole('button', { name: 'Scrivi di nuovo il link' })).toBeInTheDocument();
    // The customer stays saved.
    expect(newCustomers(fixture)).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Più tardi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fixture.cards.cards()).toContainEqual(
      expect.objectContaining({ uid: NEW_ONE.uid, linkState: 'not-written' }),
    );
  });

  it('reads are ignored while the link is written', async () => {
    const fixture = writeSetup();
    await saveWithReadCard(fixture);
    await currentWrite(fixture);
    const before = lookups(fixture).length;
    tap(fixture, NEW_TWO.read);
    expect(lookups(fixture)).toHaveLength(before);
  });

  it('a phone that does not write: saved with the card, the destination opens at once', async () => {
    const fixture = writeSetup({ card: createTestCardReader({ writable: false }) });
    const { router, saved } = await saveFromLink(fixture);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved.id}/spesa`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fixture.cards.service.issueLink).not.toHaveBeenCalled();
    expect(fixture.writes).toHaveLength(0);
    expect(fixture.cards.cards()).toContainEqual(
      expect.objectContaining({ uid: NEW_ONE.uid, customerId: saved.id, active: true }),
    );
  });

  it('the card saved does not load: «Riprova» loads it again and the write starts', async () => {
    const fixture = writeSetup();
    fixture.cards.failNext('getActiveCard', 'lost');
    await saveFromLink(fixture);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Link non scritto');
    expect(alert).toHaveTextContent('Controlla la connessione e riprova.');
    expect(screen.getByRole('button', { name: 'Più tardi' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    const write = await currentWrite(fixture);
    expect(write.options.expectedUid).toBe(NEW_ONE.uid);
  });

  it('the card saved does not load: «Più tardi» opens the destination', async () => {
    const fixture = writeSetup();
    fixture.cards.failNext('getActiveCard', 'lost');
    const { router, saved } = await saveFromLink(fixture);
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Più tardi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved.id}/spesa`));
    expect(fixture.writes).toHaveLength(0);
  });

  it('a lost answer and «Riprova» on the save: one customer, the write on its card', async () => {
    const fixture = writeSetup();
    await renderNew(fixture, fromHome(NEW_ONE.uid));
    await fillValid();
    fixture.cards.failNext('createCustomerWithCard', 'lost');
    save();
    await screen.findByRole('alert');
    save();
    const write = await currentWrite(fixture);
    expect(write.options.expectedUid).toBe(NEW_ONE.uid);
    expect(newCustomers(fixture)).toHaveLength(1);
    expect(fixture.cards.service.issueLink).toHaveBeenCalledOnce();
  });

  describe('a resend after a lost answer with another card: the card is not associated, and it says so', () => {
    it('card A from the home saved, answer lost, card B read and «Riprova»: notice, «Associa card» opens Associa card', async () => {
      const fixture = writeSetup();
      const { router } = await renderNew(fixture, fromHome(NEW_ONE.uid));
      await fillValid();
      fixture.cards.failNext('createCustomerWithCard', 'lost');
      save();
      await screen.findByRole('alert');
      tap(fixture, NEW_TWO.read);
      await screen.findByText(new RegExp(`Codice ${NEW_TWO.uid}`));
      save();

      await noticeOf(router);
      const [saved] = newCustomers(fixture);
      if (!saved) throw new Error('no customer');
      expect(newCustomers(fixture)).toHaveLength(1);
      // Neither card is written: the one saved is not the one in hand.
      expect(fixture.writes).toHaveLength(0);
      const associate = screen.getByRole('link', { name: 'Associa card' });
      expect(associate).toHaveAttribute('href', `/clienti/${saved.id}/card`);
      await userEvent.click(associate);
      await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved.id}/card`));
    });

    it('saved without a card, answer lost, card B read and «Riprova»: notice, «Più tardi» opens the destination', async () => {
      const fixture = writeSetup();
      const { router } = await renderNew(fixture);
      await activeSection();
      await fillValid();
      fixture.customers.failNext('create', 'lost');
      save();
      await screen.findByRole('alert');
      tap(fixture, NEW_TWO.read);
      await screen.findByRole('region', { name: 'Card letta' });
      save();

      await noticeOf(router);
      const [saved] = newCustomers(fixture);
      if (!saved) throw new Error('no customer');
      expect(fixture.cards.cards()).not.toContainEqual(
        expect.objectContaining({ uid: NEW_TWO.uid }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Più tardi' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved.id}`));
      expect(router.state.historyAction).toBe('REPLACE');
    });
  });
});
