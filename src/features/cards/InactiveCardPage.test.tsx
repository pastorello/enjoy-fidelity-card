import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import type { CardWriteResult, CardWriteStep, WriteUrlOptions } from '../card-input/webNfcWriter';
import { fakeOperator } from '../../test/fakeAuthService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

// SPEC-customers-v2, point 4 ("Schermata «Card non attiva»") and point 5; criterion 10. Invented
// customers and uids only.

const MARIA = fakeCustomer({ name: 'Maria Rossi', balance: 120 });
const GIULIA = fakeCustomer({ name: 'Giulia Bianchi', balance: 1500 });
const ERASED = fakeCustomer({ name: 'cancellato-7f3a', anonymizedAt: '2026-11-17T09:00:00.000Z' });

const MARIA_ACTIVE = fakeCard({ uid: '04A1B2C3D4E5F6', customerId: MARIA.id });
const MARIA_LOST = fakeCard({
  uid: '04112233445566',
  customerId: MARIA.id,
  active: false,
  // 12 November in Rome.
  deactivatedAt: '2026-11-11T23:30:00.000Z',
});
const GIULIA_LOST = fakeCard({
  uid: '04DEADBEEF0001',
  customerId: GIULIA.id,
  active: false,
  deactivatedAt: '2026-11-15T10:00:00.000Z',
});
const GIULIA_RELEASED = fakeCard({
  uid: '04DEADBEEF0002',
  customerId: GIULIA.id,
  active: false,
  deactivatedAt: '2026-11-14T10:00:00.000Z',
});
const OF_ERASED = fakeCard({
  uid: '04778899AABBCC',
  customerId: ERASED.id,
  active: false,
  deactivatedAt: '2026-11-17T09:00:00.000Z',
});
const UNKNOWN_ID = '00000000-0000-4000-a000-0000000fffff';

const OPERATOR_ONLY = 'Solo un amministratore può riattivare o riformattare una card.';

beforeEach(() => {
  // «Disattivata il 12 nov», without the year: the tests run as if in November 2026.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** One `writeUrl` call, ended by the test with `finish`. */
type WriteCall = {
  url: string;
  options: WriteUrlOptions;
  step: (step: CardWriteStep) => void;
  finish: (result: CardWriteResult) => Promise<void>;
};

/** One `eraseCard` call, ended by the test with `finish`. */
type EraseCall = Omit<WriteCall, 'url'>;

async function setup({
  role = 'admin',
  writable = true,
}: { role?: 'admin' | 'operator'; writable?: boolean } = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA, GIULIA, ERASED] });
  const cards = createFakeCardsService({
    customers,
    cards: [MARIA_ACTIVE, MARIA_LOST, GIULIA_LOST, GIULIA_RELEASED, OF_ERASED],
  });
  // Reformatted by another administrator: the row stays, with `released_at`.
  await cards.service.releaseCard('00000000-0000-4000-8000-0000000000aa', GIULIA_RELEASED.id);
  cards.calls.length = 0;
  const auth = signedInFake({ operator: { ...fakeOperator, role } });
  const reader = createTestCardReader({ writable });
  // The link writes are driven by the tests: each `writeUrl` waits for `finish` (or its signal).
  const writes: WriteCall[] = [];
  vi.spyOn(reader.reader, 'writeUrl').mockImplementation(
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
  // The erases of Riformatta, driven the same way.
  const erases: EraseCall[] = [];
  vi.spyOn(reader.reader, 'eraseCard').mockImplementation(
    (options) =>
      new Promise<CardWriteResult>((resolve) => {
        erases.push({
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
  return { customers, cards, auth, reader, writes, erases };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

function renderPage(fixture: Fixture, cardId: string) {
  return renderApp(
    `/card/${cardId}`,
    fixture.auth,
    createFakeSettingsService(),
    fixture.customers,
    createFakeRewardsService(),
    fixture.reader,
    fixture.cards,
  );
}

function main(): HTMLElement {
  return screen.getByRole('main');
}

const REACTIVATE = 'Riattiva la card';
const SKIP = 'Salta, lo scrivo più tardi';
const LINK = /^https?:\/\/[^/]+\/s\/[A-Za-z0-9_-]{22}$/;

function reactivations(fixture: Fixture) {
  return fixture.cards.calls
    .filter((call) => call.method === 'reactivateCard')
    .map((call) => call.args);
}

/** The write in progress (the last `writeUrl` call), once it has started. */
async function currentWrite(fixture: Fixture): Promise<WriteCall> {
  await waitFor(() => expect(fixture.writes.length).toBeGreaterThan(0));
  const write = fixture.writes.at(-1);
  if (!write) throw new Error('no write');
  return write;
}

/** The one-time confirmation of the customer page, written a moment after the page opens. */
async function expectConfirmation(text: string) {
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text));
}

/** «Card …E5F6 riattivata per Maria», the status over the write of the link. */
async function expectReactivated(text: string) {
  const reactivated = await screen.findByText(
    (_content, element) => element?.tagName === 'OUTPUT' && element.textContent === text,
  );
  expect(reactivated).toHaveRole('status');
}

function cardOf(fixture: Fixture, id: string) {
  return fixture.cards.cards().find((card) => card.id === id);
}

describe('«Card non attiva» (/card/:cardId)', () => {
  it('shows the card, its customer and what Riattiva and Riformatta would do', async () => {
    const fixture = await setup();
    const { router } = renderPage(fixture, MARIA_LOST.id);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Card non attiva' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Card …5566')).toBeInTheDocument();
    expect(screen.getByText('Disattivata il 12 nov')).toBeInTheDocument();

    const customer = screen.getByRole('link', { name: /Era di Maria Rossi/ });
    expect(customer).toHaveAttribute('href', `/clienti/${MARIA.id}`);
    expect(within(customer).getByText('120 punti')).toBeInTheDocument();

    // Maria has another active card: reactivating swaps them.
    expect(
      screen.getByText(
        'La card torna a Maria al posto della card …E5F6, che si disattiva. I punti restano a Maria.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'La card si svuota e non sarà più di Maria, per sempre: potrà essere data a un cliente nuovo. Punti e movimenti restano a Maria.',
      ),
    ).toBeInTheDocument();

    // By the id of the row: the uid is never in the URL, and nothing is written.
    expect(router.state.location.pathname).toBe(`/card/${MARIA_LOST.id}`);
    expect(router.state.location.pathname).not.toContain(MARIA_LOST.uid);
    expect(fixture.cards.calls.map((call) => call.method)).toEqual(['getCard']);
    expect(fixture.cards.service.getCard).toHaveBeenCalledWith(MARIA_LOST.id);
  });

  it('without another active card, Riattiva gives the card back to the customer', async () => {
    const fixture = await setup();
    renderPage(fixture, GIULIA_LOST.id);
    expect(
      await screen.findByText('La card torna a Giulia e apre di nuovo la sua spesa.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Disattivata il 15 nov')).toBeInTheDocument();
    expect(screen.queryByText(/al posto della card/)).toBeNull();
  });

  it('back goes home', async () => {
    const fixture = await setup();
    renderPage(fixture, MARIA_LOST.id);
    await screen.findByText('Card …5566');
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/');
  });

  it('shows the loading state while the card arrives', async () => {
    const fixture = await setup();
    const { release } = fixture.cards.holdNext('getCard');
    renderPage(fixture, MARIA_LOST.id);
    await screen.findByRole('heading', { level: 1, name: 'Card non attiva' });
    expect(within(main()).getByText('Caricamento…')).toBeInTheDocument();
    release();
    expect(await screen.findByText('Card …5566')).toBeInTheDocument();
  });

  describe('card of an erased customer (point 5, criterion 10)', () => {
    it('has no customer row and no Riattiva, only Riformatta', async () => {
      const fixture = await setup();
      renderPage(fixture, OF_ERASED.id);
      expect(
        await screen.findByText('Era di un cliente i cui dati sono stati cancellati.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'La card si svuota e torna come nuova: potrà essere data a un cliente nuovo.',
        ),
      ).toBeInTheDocument();
      expect(within(main()).queryByRole('link')).toBeNull();
      expect(screen.queryByText(/Riattiva/)).toBeNull();
      expect(screen.queryByRole('button', { name: REACTIVATE })).toBeNull();
      expect(screen.queryByText(/La card torna a/)).toBeNull();
      expect(screen.queryByText(/cancellato-7f3a/)).toBeNull();
    });
  });

  describe('states', () => {
    it('«Card non trovata» for an id that is no card, with a way home', async () => {
      const fixture = await setup();
      renderPage(fixture, UNKNOWN_ID);
      expect(
        await screen.findByRole('heading', { level: 2, name: 'Card non trovata' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Torna all’inizio' })).toHaveAttribute('href', '/');
    });

    it('«Card non trovata» for an id that is not a uuid, without asking the server', async () => {
      const fixture = await setup();
      renderPage(fixture, '04112233445566');
      expect(
        await screen.findByRole('heading', { level: 2, name: 'Card non trovata' }),
      ).toBeInTheDocument();
      expect(fixture.cards.service.getCard).not.toHaveBeenCalled();
    });

    it('an error offers «Riprova», which loads again', async () => {
      const fixture = await setup();
      fixture.cards.failNext('getCard', 'network');
      renderPage(fixture, MARIA_LOST.id);
      const alert = await screen.findByRole('alert');
      expect(within(alert).getByText('Card non caricata')).toBeInTheDocument();
      expect(within(alert).getByText('Controlla la connessione e riprova.')).toBeInTheDocument();
      await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
      expect(await screen.findByText('Card …5566')).toBeInTheDocument();
      expect(fixture.cards.service.getCard).toHaveBeenCalledTimes(2);
    });

    it('a server fault is not a connection problem', async () => {
      const fixture = await setup();
      fixture.cards.failNext('getCard', new ServerFaultError('unavailable'));
      renderPage(fixture, MARIA_LOST.id);
      expect(
        await screen.findByText('Servizio momentaneamente non disponibile: riprova tra poco.'),
      ).toBeInTheDocument();
    });

    it('a card already active (reactivated meanwhile) opens its customer', async () => {
      const fixture = await setup();
      renderPage(fixture, MARIA_ACTIVE.id);
      expect(
        await screen.findByRole('heading', { level: 2, name: 'Questa card è attiva.' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Apri la scheda di Maria' })).toHaveAttribute(
        'href',
        `/clienti/${MARIA.id}`,
      );
      expect(screen.queryByText(/La card si svuota/)).toBeNull();
    });

    it('a card already reformatted is free', async () => {
      const fixture = await setup();
      renderPage(fixture, GIULIA_RELEASED.id);
      expect(
        await screen.findByRole('heading', {
          level: 2,
          name: 'Questa card è già stata riformattata: ora è libera.',
        }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Torna all’inizio' })).toHaveAttribute('href', '/');
      expect(screen.queryByText(/Giulia/)).toBeNull();
    });

    it('an operator opening the URL by hand is told it is for admins, without a request', async () => {
      const fixture = await setup({ role: 'operator' });
      const { router } = renderPage(fixture, MARIA_LOST.id);
      const alert = await screen.findByRole('alert');
      expect(within(alert).getByRole('heading', { name: OPERATOR_ONLY })).toBeInTheDocument();
      expect(screen.queryByText(/Maria/)).toBeNull();
      expect(fixture.cards.service.getCard).not.toHaveBeenCalled();
      await userEvent.click(within(alert).getByRole('button', { name: 'Torna all’inizio' }));
      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
    });
  });
});

describe('Riattiva (SPEC-customers-v2 point 4, criterion 8)', () => {
  it('without another active card: always a confirmation, and no call before «Riattiva»', async () => {
    const fixture = await setup();
    renderPage(fixture, GIULIA_LOST.id);
    await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));

    const dialog = screen.getByRole('dialog', { name: 'Riattivare la card …0001?' });
    expect(dialog).toHaveAccessibleDescription(
      'Disattivata il 15 nov. Riattiva solo se la card è tornata a Giulia: chi la usa potrà spendere i suoi punti.',
    );
    // «Lascia com'è» changes nothing.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(reactivations(fixture)).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: REACTIVATE }));
    expect(reactivations(fixture)).toEqual([]);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Riattiva' }),
    );
    expect(reactivations(fixture)).toEqual([[GIULIA_LOST.id, null]]);
    await expectReactivated('Card …0001 riattivata per Giulia');
    expect(cardOf(fixture, GIULIA_LOST.id)?.active).toBe(true);
  });

  it('with another active card: «Scambiare le card di Maria?» and the swap names that card', async () => {
    const fixture = await setup();
    renderPage(fixture, MARIA_LOST.id);
    await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));

    const dialog = screen.getByRole('dialog', { name: 'Scambiare le card di Maria?' });
    expect(dialog).toHaveAccessibleDescription(
      'La card …5566 (disattivata il 12 nov) torna attiva. Riattiva solo se la card è tornata a Maria: chi la usa potrà spendere i suoi punti. La card …E5F6, ora attiva, si disattiva e il suo link non mostrerà più i punti. I punti restano a Maria.',
    );
    expect(reactivations(fixture)).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Scambia le card' }));

    expect(reactivations(fixture)).toEqual([[MARIA_LOST.id, MARIA_ACTIVE.id]]);
    await expectReactivated('Card …5566 riattivata per Maria');
    // One active card: the other one was swapped out.
    expect(cardOf(fixture, MARIA_ACTIVE.id)?.active).toBe(false);
    expect(cardOf(fixture, MARIA_LOST.id)?.active).toBe(true);
  });

  it('active_card_changed: the page loads again and asks again, with the right card', async () => {
    const fixture = await setup();
    renderPage(fixture, GIULIA_LOST.id);
    await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));
    // Meanwhile another operator gives Giulia a new card.
    const { card: other } = await fixture.cards.service.associate(GIULIA.id, '04CAFE00000077');
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Riattiva' }),
    );

    // Asked again: a new dialog, with the card Giulia has now.
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: 'Scambiare le card di Giulia?' }),
      ).toHaveAccessibleDescription(/La card …0077, ora attiva, si disattiva/),
    );
    const dialog = screen.getByRole('dialog');
    expect(fixture.cards.service.getCard).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/al posto della card …0077/)).toBeInTheDocument();
    expect(cardOf(fixture, other.id)?.active).toBe(true);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Scambia le card' }));
    expect(reactivations(fixture)).toEqual([
      [GIULIA_LOST.id, null],
      [GIULIA_LOST.id, other.id],
    ]);
    await expectReactivated('Card …0001 riattivata per Giulia');
    expect(cardOf(fixture, other.id)?.active).toBe(false);
  });

  it('forbidden: «Card non attiva: chiedi a un amministratore.», and no Riattiva any more', async () => {
    const fixture = await setup();
    fixture.cards.failNext('reactivateCard', 'forbidden');
    renderPage(fixture, GIULIA_LOST.id);
    await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Riattiva' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Card non attiva: chiedi a un amministratore.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: REACTIVATE })).toBeNull();
    expect(cardOf(fixture, GIULIA_LOST.id)?.active).toBe(false);
  });

  it.each([
    ['card_released', 'Questa card è già stata riformattata.'],
    ['customer_anonymized', 'Questo cliente non può avere una card.'],
  ] as const)('%s: the text of the spec', async (kind, text) => {
    const fixture = await setup();
    fixture.cards.failNext('reactivateCard', kind);
    renderPage(fixture, GIULIA_LOST.id);
    await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Riattiva' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByRole('button', { name: REACTIVATE })).toBeNull();
  });

  it('no answer: the dialog stays with «Riprova», which sends the same request (safe)', async () => {
    const fixture = await setup();
    // Applied on the server, the answer lost: sending it again changes nothing.
    fixture.cards.failNext('reactivateCard', 'lost');
    renderPage(fixture, MARIA_LOST.id);
    await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Scambia le card' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Card non riattivata: controlla la connessione.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Riprova' }));
    expect(reactivations(fixture)).toEqual([
      [MARIA_LOST.id, MARIA_ACTIVE.id],
      [MARIA_LOST.id, MARIA_ACTIVE.id],
    ]);
    await expectReactivated('Card …5566 riattivata per Maria');
  });

  it('a server fault is said as such, with «Riprova»', async () => {
    const fixture = await setup();
    fixture.cards.failNext('reactivateCard', new ServerFaultError('unavailable'));
    renderPage(fixture, GIULIA_LOST.id);
    await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Riattiva' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Card non riattivata. Servizio momentaneamente non disponibile: riprova tra poco.',
    );
    expect(within(dialog).getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
  });

  it('a double tap on the confirmation sends one request', async () => {
    const fixture = await setup();
    const { release } = fixture.cards.holdNext('reactivateCard');
    renderPage(fixture, GIULIA_LOST.id);
    await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Riattiva' });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    release();
    await expectReactivated('Card …0001 riattivata per Giulia');
    expect(reactivations(fixture)).toHaveLength(1);
  });

  describe('the link, written after the reactivation', () => {
    it('is written on the card (a token, never the uid); then the customer page says «riattivata»', async () => {
      const fixture = await setup();
      const { router } = renderPage(fixture, GIULIA_LOST.id);
      await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Riattiva' }),
      );

      const status = await screen.findByRole('status');
      expect(status).toHaveTextContent('Card …0001 riattivata per Giulia');
      const write = await currentWrite(fixture);
      expect(screen.getByRole('region', { name: 'Scrittura del link' })).toBeInTheDocument();
      expect(write.options.expectedUid).toBe(GIULIA_LOST.uid);
      expect(write.url).toMatch(LINK);
      expect(write.url.toUpperCase()).not.toContain(GIULIA_LOST.uid);

      await write.finish({ ok: true });
      await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${GIULIA.id}`));
      expect(router.state.historyAction).toBe('REPLACE');
      await expectConfirmation('Card …0001 riattivata');
      expect(screen.getByRole('status')).not.toHaveTextContent('Link non scritto');
      expect(cardOf(fixture, GIULIA_LOST.id)?.linkState).toBe('written');
    });

    it('«Salta, lo scrivo più tardi»: the customer page with «Link non scritto.»', async () => {
      const fixture = await setup();
      const { router } = renderPage(fixture, GIULIA_LOST.id);
      await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Riattiva' }),
      );
      const write = await currentWrite(fixture);
      await userEvent.click(screen.getByRole('button', { name: SKIP }));
      expect(write.options.signal?.aborted).toBe(true);
      await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${GIULIA.id}`));
      await expectConfirmation('Card …0001 riattivata. Link non scritto.');
      // The reactivation stays.
      expect(cardOf(fixture, GIULIA_LOST.id)).toMatchObject({
        active: true,
        linkState: 'not-written',
      });
    });

    it('a device that does not write: the customer page at once, «Link non scritto.»', async () => {
      const fixture = await setup({ writable: false });
      const { router } = renderPage(fixture, GIULIA_LOST.id);
      await userEvent.click(await screen.findByRole('button', { name: REACTIVATE }));
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Riattiva' }),
      );
      await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${GIULIA.id}`));
      expect(router.state.historyAction).toBe('REPLACE');
      await expectConfirmation('Card …0001 riattivata. Link non scritto.');
      expect(fixture.cards.service.issueLink).not.toHaveBeenCalled();
      expect(fixture.writes).toHaveLength(0);
      expect(cardOf(fixture, GIULIA_LOST.id)?.active).toBe(true);
    });
  });
});

const REFORMAT = 'Riformatta la card';
const DEVICE_NOTE =
  'Per riformattare la card serve un telefono Android con l’NFC attivo: apri Enjoy Card sul telefono e avvicina la card.';

function releases(fixture: Fixture) {
  return fixture.cards.calls
    .filter((call) => call.method === 'releaseCard')
    .map((call) => call.args);
}

/** The erase in progress (the last `eraseCard` call), once it has started. */
async function currentErase(fixture: Fixture): Promise<EraseCall> {
  await waitFor(() => expect(fixture.erases.length).toBeGreaterThan(0));
  const erase = fixture.erases.at(-1);
  if (!erase) throw new Error('no erase');
  return erase;
}

function panel(): HTMLElement {
  return screen.getByRole('region', { name: 'Riformattazione della card' });
}

/** «Riformatta la card», then «Riformatta» in the confirmation: the erase starts. */
async function startReformat(fixture: Fixture, cardId = MARIA_LOST.id) {
  const rendered = renderPage(fixture, cardId);
  await userEvent.click(await screen.findByRole('button', { name: REFORMAT }));
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Riformatta' }),
  );
  return { ...rendered, erase: await currentErase(fixture) };
}

describe('Riformatta (SPEC-customers-v2 points 4 and 5, criteria 9 and 10)', () => {
  it('asks first, in the danger tone, and nothing is written before «Riformatta»', async () => {
    const fixture = await setup();
    renderPage(fixture, MARIA_LOST.id);
    await userEvent.click(await screen.findByRole('button', { name: REFORMAT }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Riformattare la card …5566?');
    expect(dialog).toHaveTextContent(
      'La card si svuota e non sarà più di Maria Rossi, per sempre. Punti e movimenti restano a Maria. Non si può tornare indietro.',
    );
    // The danger tone starts on the way out, not on the irreversible action.
    expect(within(dialog).getByRole('button', { name: 'Lascia com’è' })).toHaveFocus();
    expect(fixture.erases).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fixture.erases).toHaveLength(0);
    expect(releases(fixture)).toEqual([]);
  });

  it('the card of an erased customer: its own confirmation, and the same outcome', async () => {
    const fixture = await setup();
    const { router } = renderPage(fixture, OF_ERASED.id);
    await userEvent.click(await screen.findByRole('button', { name: REFORMAT }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(
      'La card si svuota e torna come nuova. Non si può tornare indietro.',
    );
    expect(dialog).not.toHaveTextContent(/cancellato-7f3a/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Riformatta' }));
    const erase = await currentErase(fixture);
    expect(erase.options.expectedUid).toBe(OF_ERASED.uid);
    await erase.finish({ ok: true });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByText('Card …BBCC riformattata: ora è libera.')).toBeInTheDocument();
    expect(releases(fixture)).toEqual([[expect.any(String), OF_ERASED.id]]);
  });

  it('shows the steps live, and releases the card only after the verification', async () => {
    const fixture = await setup();
    const { router, erase } = await startReformat(fixture);

    expect(erase.options.expectedUid).toBe(MARIA_LOST.uid);
    expect(erase.options.allowUnreadable).toBeFalsy();
    const live = within(panel())
      .getByText(/Avvicina la card/)
      .closest('[aria-live]');
    expect(live).toHaveAttribute('aria-live', 'polite');

    erase.step('waiting-card');
    expect(panel()).toHaveTextContent('Avvicina la card …5566');
    erase.step('writing');
    expect(panel()).toHaveTextContent('Tieni la card appoggiata');
    expect(panel()).toHaveTextContent('Svuoto la card…');
    erase.step('verifying');
    expect(panel()).toHaveTextContent('Controllo: allontana la card e riavvicinala');
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
    // Criterion 9: the server unbinds the card only once it reads back empty.
    expect(releases(fixture)).toEqual([]);

    await erase.finish({ ok: true });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByText('Card …5566 riformattata: ora è libera.')).toBeInTheDocument();

    expect(releases(fixture)).toEqual([
      [
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        MARIA_LOST.id,
      ],
    ]);
    // The uid is free again: the same card read on the home is unknown.
    await expect(fixture.cards.service.lookup(MARIA_LOST.uid)).resolves.toMatchObject({
      status: 'unknown',
    });
  });

  it('«Annulla» stops the erase through its signal: back to the card, nothing sent', async () => {
    const fixture = await setup();
    const { erase } = await startReformat(fixture);
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(erase.options.signal?.aborted).toBe(true);
    expect(screen.queryByRole('region', { name: 'Riformattazione della card' })).toBeNull();
    expect(await screen.findByRole('button', { name: REFORMAT })).toBeInTheDocument();
    expect(releases(fixture)).toEqual([]);
  });

  it.each([
    [{ ok: false, reason: 'timeout' }, 'Card non riformattata: si è staccata troppo presto.'],
    [{ ok: false, reason: 'io' }, 'Card non riformattata: si è staccata troppo presto.'],
    [
      { ok: false, reason: 'wrong-card', otherUid: '04AABBCCDDABCD', mayHaveWritten: false },
      'Questa non è la card …5566: avvicina quella giusta.',
    ],
    [
      { ok: false, reason: 'wrong-card', otherUid: '04AABBCCDDABCD', mayHaveWritten: true },
      'Questa non è la card …5566. La card …ABCD potrebbe essere stata svuotata: se aveva il link ai punti, riscrivilo dalla scheda del suo cliente.',
    ],
    [{ ok: false, reason: 'verify-failed' }, 'La card non risulta vuota. Riprova.'],
    [
      { ok: false, reason: 'not-allowed' },
      'Il telefono non permette di scrivere la card: controlla il permesso NFC di Chrome.',
    ],
  ] as const)('%o: its text, «Riprova» erases again, nothing is released', async (result, text) => {
    const fixture = await setup();
    const { erase } = await startReformat(fixture);
    await erase.finish(result);

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
    expect(releases(fixture)).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(fixture.erases).toHaveLength(2);
    expect(fixture.erases[1]?.options.allowUnreadable).toBeFalsy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('unreadable: «Riformatta comunque» erases a card whose content does not read', async () => {
    const fixture = await setup();
    const { erase } = await startReformat(fixture);
    await erase.finish({ ok: false, reason: 'unreadable' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La card non si legge. È la card …5566? Puoi riformattarla comunque.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Riformatta comunque' }));
    const again = await currentErase(fixture);
    expect(fixture.erases).toHaveLength(2);
    expect(again.options.allowUnreadable).toBe(true);
    expect(again.options.expectedUid).toBe(MARIA_LOST.uid);
  });

  it('emptied but not released: «Riprova» sends the same operation_id, without the card', async () => {
    const fixture = await setup();
    // Applied on the server, the answer lost: the same operation_id changes nothing.
    fixture.cards.failNext('releaseCard', 'lost');
    const { router, erase } = await startReformat(fixture);
    await erase.finish({ ok: true });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Card svuotata ma non liberata: controlla la connessione.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));

    const sent = releases(fixture);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    // No new write: the card is already empty.
    expect(fixture.erases).toHaveLength(1);
  });

  it('a server fault after the write is said as such, with «Riprova» on the same operation_id', async () => {
    const fixture = await setup();
    fixture.cards.failNext('releaseCard', new ServerFaultError('unavailable'));
    const { erase } = await startReformat(fixture);
    await erase.finish({ ok: true });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Card svuotata ma non liberata. Servizio momentaneamente non disponibile: riprova tra poco.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(releases(fixture)).toHaveLength(2));
    const sent = releases(fixture);
    expect(sent[1]).toEqual(sent[0]);
  });

  it('a new «Riformatta» after giving up keeps the operation_id the server may have applied', async () => {
    const fixture = await setup();
    fixture.cards.failNext('releaseCard', 'network');
    const { erase } = await startReformat(fixture);
    await erase.finish({ ok: true });
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));

    await userEvent.click(await screen.findByRole('button', { name: REFORMAT }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Riformatta' }),
    );
    const again = await currentErase(fixture);
    await again.finish({ ok: true });
    await waitFor(() => expect(releases(fixture)).toHaveLength(2));
    const sent = releases(fixture);
    expect(sent[1]).toEqual(sent[0]);
  });

  it('card_active: reactivated meanwhile, not released, and its link must be written again', async () => {
    const fixture = await setup();
    fixture.cards.failNext('releaseCard', 'card_active');
    const { erase } = await startReformat(fixture);
    await erase.finish({ ok: true });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La card è stata riattivata nel frattempo e non è stata liberata. Il suo link è stato cancellato: riscrivilo dalla scheda di Maria.',
    );
    expect(screen.queryByRole('button', { name: 'Riprova' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Apri la scheda di Maria' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}`,
    );
  });

  it('forbidden: «Card non attiva: chiedi a un amministratore.», no «Riprova»', async () => {
    const fixture = await setup();
    fixture.cards.failNext('releaseCard', 'forbidden');
    const { erase } = await startReformat(fixture);
    await erase.finish({ ok: true });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Card non attiva: chiedi a un amministratore.',
    );
    expect(screen.queryByRole('button', { name: 'Riprova' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Torna all’inizio' })).toHaveAttribute('href', '/');
  });

  it('a phone that stops writing mid-way gets the note in place of the button', async () => {
    const fixture = await setup();
    const { erase } = await startReformat(fixture);
    await erase.finish({ ok: false, reason: 'cannot-write' });
    expect(await screen.findByText(DEVICE_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: REFORMAT })).toBeNull();
    expect(screen.getByRole('button', { name: REACTIVATE })).toBeInTheDocument();
    expect(releases(fixture)).toEqual([]);
  });

  it('a device that does not write: the note in place of «Riformatta la card», Riattiva stays', async () => {
    const fixture = await setup({ writable: false });
    renderPage(fixture, MARIA_LOST.id);
    expect(await screen.findByText(DEVICE_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: REFORMAT })).toBeNull();
    expect(screen.getByRole('button', { name: REACTIVATE })).toBeInTheDocument();
  });
});
