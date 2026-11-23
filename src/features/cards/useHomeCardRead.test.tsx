import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { fakeDevice } from '../../test/fakeAuthService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const MARIA = fakeCustomer({ name: 'Maria Rossi', balance: 120 });
const ERASED = fakeCustomer({ name: 'cancellato-7f3a', anonymizedAt: '2026-11-17T09:00:00.000Z' });

/** Uids as Web NFC gives them, and as the app keeps them. */
const ACTIVE = { read: '04:a1:b2:c3:d4:e5:f6', uid: '04A1B2C3D4E5F6' };
const LOST = { read: '04:11:22:33:44:55:66', uid: '04112233445566' };
const OF_ERASED = { read: '04:77:88:99:aa:bb:cc', uid: '04778899AABBCC' };
const UNKNOWN = { read: '04:de:ad:be:ef:00:01', uid: '04DEADBEEF0001' };

/** The panel's title on the phone, and on the till (USB reader). */
const HOME_TITLE = /^(Avvicina la card|Passa la card sul lettore)$/;

const ADMIN = { id: 'op-1', name: 'Giulia Prova', role: 'admin' as const };
const OPERATOR = { id: 'op-2', name: 'Marco Prova', role: 'operator' as const };

const LOST_CARD = fakeCard({
  uid: LOST.uid,
  customerId: MARIA.id,
  active: false,
  deactivatedAt: '2026-11-16T10:00:00.000Z',
});
const ERASED_CARD = fakeCard({ uid: OF_ERASED.uid, customerId: ERASED.id, active: false });

const NOT_ACTIVE_TITLE = 'Card non attiva: chiedi a un amministratore';

function setup({ auth = signedInFake({ operator: OPERATOR }) } = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA, ERASED] });
  const cards = createFakeCardsService({
    customers,
    cards: [fakeCard({ uid: ACTIVE.uid, customerId: MARIA.id }), LOST_CARD, ERASED_CARD],
  });
  const card = createTestCardReader();
  return { customers, cards, card, auth };
}

async function renderHome(fixture = setup(), path = '/') {
  const rendered = renderApp(
    path,
    fixture.auth,
    createFakeSettingsService(),
    fixture.customers,
    createFakeRewardsService(),
    fixture.card,
    fixture.cards,
  );
  const panel = await screen.findByRole('region', { name: 'Lettura card' });
  await within(panel).findByText(path === '/' ? HOME_TITLE : /Lettura attiva/);
  return rendered;
}

function cardPanel() {
  return screen.getByRole('region', { name: 'Lettura card' });
}

function tap(fixture: ReturnType<typeof setup>, read: string) {
  act(() => {
    fixture.card.nfc.read(read);
  });
}

function lookups(fixture: ReturnType<typeof setup>) {
  return fixture.cards.calls.filter((call) => call.method === 'lookup');
}

describe('useHomeCardRead: a card read on the home', () => {
  it('an active card opens Registra spesa of its customer, with name and balance', async () => {
    const fixture = setup();
    const { router } = await renderHome(fixture);
    tap(fixture, ACTIVE.read);

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/spesa`));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Registra spesa' }),
    ).toBeInTheDocument();
    const row = await screen.findByRole('link', { name: /Maria Rossi/ });
    expect(row).toHaveAttribute('href', `/clienti/${MARIA.id}`);
    expect(row).toHaveTextContent('120 pt');
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/');
    expect(lookups(fixture).map((call) => call.args)).toEqual([[ACTIVE.uid]]);
  });

  it('the active card path never issues a link nor writes the card (criterion 14)', async () => {
    const fixture = setup();
    const { router } = await renderHome(fixture);
    tap(fixture, ACTIVE.read);
    await screen.findByRole('heading', { level: 1, name: 'Registra spesa' });
    await screen.findByRole('link', { name: /Maria Rossi/ });

    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/spesa`);
    const methods = fixture.cards.calls.map((call) => call.method);
    expect(methods).not.toContain('issueLink');
    expect(methods).not.toContain('confirmLink');
    expect(fixture.card.nfc.writes).toHaveLength(0);
  });

  it('an unknown card opens Nuovo cliente with the card', async () => {
    const fixture = setup();
    const { router } = await renderHome(fixture);
    tap(fixture, UNKNOWN.read);

    await waitFor(() => expect(router.state.location.pathname).toBe('/clienti/nuovo'));
    // The uid travels in the history state, never in the URL (SPEC-customers-v2 point 6).
    expect(router.state.location.search).not.toContain(UNKNOWN.uid);
    expect(router.state.location.search).toBe('');
    expect(router.state.location.state).toEqual({ card: UNKNOWN.uid });
  });

  it('operator, a deactivated card: "Card non attiva: chiedi a un amministratore" with the customer (criterion 11)', async () => {
    const fixture = setup();
    const { router } = await renderHome(fixture);
    tap(fixture, LOST.read);

    const alert = await within(cardPanel()).findByRole('alert');
    expect(alert).toHaveTextContent(NOT_ACTIVE_TITLE);
    expect(alert).toHaveTextContent(
      'Era la card di Maria Rossi. Per servirla adesso cercala per nome o email.',
    );
    const open = within(cardPanel()).getByRole('link', { name: 'Apri la scheda di Maria' });
    expect(open).toHaveAttribute('href', `/clienti/${MARIA.id}`);
    // One flex item: the button's gap never adds to the space before the name.
    expect(open.childNodes).toHaveLength(1);
    expect(open).toHaveTextContent(/^Apri la scheda di Maria$/);
    expect(router.state.location.pathname).toBe('/');
    // The search stays usable, and nothing but the lookup was asked.
    expect(screen.getByRole('searchbox')).toBeEnabled();
    expect(fixture.cards.calls.map((call) => call.method)).toEqual(['lookup']);
  });

  it('operator, a card of an erased customer: same title, no name, no link to the customer', async () => {
    const fixture = setup();
    const { router } = await renderHome(fixture);
    tap(fixture, OF_ERASED.read);

    const alert = await within(cardPanel()).findByRole('alert');
    expect(alert).toHaveTextContent(NOT_ACTIVE_TITLE);
    expect(alert).toHaveTextContent('I dati del cliente di questa card sono stati cancellati.');
    expect(cardPanel()).not.toHaveTextContent('cancellato-7f3a');
    expect(within(cardPanel()).queryByRole('link')).not.toBeInTheDocument();
    expect(within(cardPanel()).queryByRole('button')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it.each([
    ['a deactivated card', LOST.read, LOST_CARD.id],
    ['a card of an erased customer', OF_ERASED.read, ERASED_CARD.id],
  ])(
    'admin, %s: «Card non attiva» at /card/:cardId, no other call, never the uid (criterion 8)',
    async (_label, read, cardId) => {
      const fixture = setup({ auth: signedInFake({ operator: ADMIN }) });
      const { router } = await renderHome(fixture);
      tap(fixture, read);

      await waitFor(() => expect(router.state.location.pathname).toBe(`/card/${cardId}`));
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Card non attiva' }),
      ).toBeInTheDocument();
      expect(router.state.location.search).toBe('');
      expect(router.state.location.pathname).not.toContain(LOST.uid);
      expect(router.state.location.pathname).not.toContain(OF_ERASED.uid);
      // The read asks only lookup_card; the page then loads its card by the id of the row.
      expect(fixture.cards.calls).toEqual([
        { method: 'lookup', args: [expect.any(String)] },
        { method: 'getCard', args: [cardId] },
      ]);
      expect(fixture.card.nfc.writes).toHaveLength(0);
    },
  );

  it('admin, an active card still opens Registra spesa with the same calls (criterion 13)', async () => {
    const fixture = setup({ auth: signedInFake({ operator: ADMIN }) });
    const { router } = await renderHome(fixture);
    tap(fixture, ACTIVE.read);

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/spesa`));
    expect(lookups(fixture).map((call) => call.args)).toEqual([[ACTIVE.uid]]);
    expect(fixture.cards.calls.map((call) => call.method)).toEqual(['lookup']);
  });

  it('on the till, an admin cashier goes to /card/:cardId, an operator cashier gets the notice', async () => {
    const admin = setup({ auth: signedInFake({ device: fakeDevice, cashier: ADMIN }) });
    const first = await renderHome(admin);
    tap(admin, LOST.read);
    await waitFor(() => expect(first.router.state.location.pathname).toBe(`/card/${LOST_CARD.id}`));
    cleanup();

    const operator = setup({ auth: signedInFake({ device: fakeDevice, cashier: OPERATOR }) });
    const second = await renderHome(operator);
    tap(operator, LOST.read);
    expect(await within(cardPanel()).findByRole('alert')).toHaveTextContent(NOT_ACTIVE_TITLE);
    expect(second.router.state.location.pathname).toBe('/');
  });

  it('while looking up: "Lettura della card…", other reads ignored', async () => {
    const fixture = setup();
    const held = fixture.cards.holdNext('lookup');
    const { router } = await renderHome(fixture);
    tap(fixture, ACTIVE.read);

    expect(await within(cardPanel()).findByText('Lettura della card…')).toBeInTheDocument();
    tap(fixture, UNKNOWN.read);
    tap(fixture, LOST.read);
    expect(lookups(fixture)).toHaveLength(1);

    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/spesa`));
    expect(lookups(fixture)).toHaveLength(1);
  });

  it('network error: "Card non letta", "Riprova" repeats the same lookup', async () => {
    const fixture = setup();
    fixture.cards.failNext('lookup', 'network');
    const { router } = await renderHome(fixture);
    tap(fixture, ACTIVE.read);

    const alert = await within(cardPanel()).findByRole('alert');
    expect(alert).toHaveTextContent('Card non letta: controlla la connessione.');
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('searchbox')).toBeEnabled();

    await userEvent.click(within(cardPanel()).getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/spesa`));
    expect(lookups(fixture).map((call) => call.args)).toEqual([[ACTIVE.uid], [ACTIVE.uid]]);
  });

  it('a server fault is worded apart from the connection', async () => {
    const fixture = setup();
    fixture.cards.failNext('lookup', new ServerFaultError('unavailable'));
    await renderHome(fixture);
    tap(fixture, ACTIVE.read);

    const alert = await within(cardPanel()).findByRole('alert');
    expect(alert).toHaveTextContent('Card non letta');
    expect(alert).toHaveTextContent('Servizio momentaneamente non disponibile: riprova tra poco.');
    expect(within(cardPanel()).getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
  });

  it('a new card replaces the notice', async () => {
    const fixture = setup();
    await renderHome(fixture);
    tap(fixture, LOST.read);
    expect(await within(cardPanel()).findByRole('alert')).toHaveTextContent('Era la card di');

    tap(fixture, OF_ERASED.read);
    await waitFor(() =>
      expect(within(cardPanel()).getByRole('alert')).toHaveTextContent(
        'I dati del cliente di questa card sono stati cancellati.',
      ),
    );
    expect(cardPanel()).not.toHaveTextContent('Era la card di');
    expect(lookups(fixture)).toHaveLength(2);
  });

  it('while a search is shown, the notice still appears in the card panel', async () => {
    const fixture = setup();
    await renderHome(fixture);
    await userEvent.type(
      screen.getByRole('searchbox', { name: /cerca per nome o email$/i }),
      'rossi',
    );
    const clients = screen.getByRole('region', { name: 'CLIENTI' });
    await within(cardPanel()).findByText(/Lettura attiva/);
    await waitFor(() => expect(within(clients).getAllByRole('link')).toHaveLength(1));
    tap(fixture, LOST.read);

    expect(await within(cardPanel()).findByRole('alert')).toHaveTextContent(NOT_ACTIVE_TITLE);
    expect(within(clients).getAllByRole('link')).toHaveLength(1);
  });

  it('not_operator: back to /accedi', async () => {
    const fixture = setup();
    fixture.cards.failNext('lookup', 'not_operator');
    const held = fixture.cards.holdNext('lookup');
    const { router } = await renderHome(fixture);
    tap(fixture, ACTIVE.read);
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
