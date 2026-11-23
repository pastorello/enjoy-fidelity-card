import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
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
});

async function setup({ role = 'admin' }: { role?: 'admin' | 'operator' } = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA, GIULIA, ERASED] });
  const cards = createFakeCardsService({
    customers,
    cards: [MARIA_ACTIVE, MARIA_LOST, GIULIA_LOST, GIULIA_RELEASED, OF_ERASED],
  });
  // Reformatted by another administrator: the row stays, with `released_at`.
  await cards.service.releaseCard('00000000-0000-4000-8000-0000000000aa', GIULIA_RELEASED.id);
  cards.calls.length = 0;
  const auth = signedInFake({ operator: { ...fakeOperator, role } });
  return { customers, cards, auth };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

function renderPage(fixture: Fixture, cardId: string) {
  return renderApp(
    `/card/${cardId}`,
    fixture.auth,
    createFakeSettingsService(),
    fixture.customers,
    createFakeRewardsService(),
    createTestCardReader(),
    fixture.cards,
  );
}

function main(): HTMLElement {
  return screen.getByRole('main');
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
