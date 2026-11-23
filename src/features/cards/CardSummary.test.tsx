import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const MARIA = fakeCustomer({ name: 'Maria Rossi', email: 'maria.rossi@example.com' });
const ROSA = fakeCustomer({ name: 'Rosa Bianchi', email: null });
const ERASED = fakeCustomer({
  name: 'Cliente cancellato abcdef12',
  email: null,
  anonymizedAt: '2026-11-17T12:00:00.000Z',
});

/** Invented uids. */
const UID = '04A1B2C3D4E5F6';
const OLD_UID = '04AABBCCDD0001';

function setup() {
  const customers = createFakeCustomerService({ customers: [MARIA, ROSA, ERASED] });
  const cards = createFakeCardsService({
    customers,
    cards: [
      fakeCard({ uid: UID, customerId: MARIA.id }),
      // A deactivated card of Rosa: she has no active one.
      fakeCard({ uid: OLD_UID, customerId: ROSA.id, active: false }),
      fakeCard({ uid: '04AABBCCDD0002', customerId: ERASED.id, active: false }),
    ],
  });
  return { customers, cards };
}

type Fixture = ReturnType<typeof setup>;

function renderCustomer(fixture: Fixture, path: string) {
  return renderApp(
    path,
    signedInFake(),
    createFakeSettingsService(),
    fixture.customers,
    createFakeRewardsService(),
    createTestCardReader(),
    fixture.cards,
  );
}

/** The line under the name: the first element of the page after the (empty) notice. */
async function summaryLine(text: string | RegExp) {
  return screen.findByText(text, { selector: 'p' });
}

describe('CardSummary: the card part of the line under the name (SPEC-cards, point 6)', () => {
  it('an active card: "Card attiva …E5F6 · maria.rossi@example.com", the full uid nowhere', async () => {
    renderCustomer(setup(), `/clienti/${MARIA.id}`);
    const line = await summaryLine('Card attiva …E5F6 · maria.rossi@example.com');
    expect(line.querySelector('svg')).not.toBeNull();
    expect(screen.queryByText(new RegExp(UID))).not.toBeInTheDocument();
  });

  it('the email in full, as plain text of the line, never a mailto: link', async () => {
    renderCustomer(setup(), `/clienti/${MARIA.id}`);
    const line = await summaryLine('Card attiva …E5F6 · maria.rossi@example.com');
    expect(line.closest('a')).toBeNull();
    expect(within(line).queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('[href^="mailto:" i]')).toBeNull();
  });

  it('no active card: "Senza card · Senza email"', async () => {
    renderCustomer(setup(), `/clienti/${ROSA.id}`);
    await summaryLine('Senza card · Senza email');
    expect(screen.queryByText(/Card attiva/)).not.toBeInTheDocument();
  });

  it('styled as "Senza email": the same muted secondary text', async () => {
    renderCustomer(setup(), `/clienti/${ROSA.id}`);
    const line = await summaryLine('Senza card · Senza email');
    expect(line.className).toMatch(/summary/);
  });

  it('while the card loads: only the email part, never a guess', async () => {
    const fixture = setup();
    const held = fixture.cards.holdNext('getActiveCard');
    renderCustomer(fixture, `/clienti/${MARIA.id}`);
    await summaryLine('maria.rossi@example.com');
    expect(screen.queryByText(/Senza card/)).not.toBeInTheDocument();
    await act(async () => {
      held.release();
    });
    await summaryLine('Card attiva …E5F6 · maria.rossi@example.com');
  });

  it('a card that cannot be loaded: "Card non caricata", not "Senza card"', async () => {
    const fixture = setup();
    fixture.cards.failNext('getActiveCard', 'network');
    renderCustomer(fixture, `/clienti/${MARIA.id}`);
    await summaryLine('Card non caricata · maria.rossi@example.com');
    expect(screen.queryByText(/Senza card/)).not.toBeInTheDocument();
  });

  it('an erased customer: the line of customers, no card part and no card request', async () => {
    const fixture = setup();
    renderCustomer(fixture, `/clienti/${ERASED.id}`);
    await summaryLine('Dati cancellati il 17 nov 2026');
    expect(screen.queryByText(/Senza card|Card attiva|Card non caricata/)).not.toBeInTheDocument();
    expect(fixture.cards.calls.filter((call) => call.method === 'getActiveCard')).toEqual([]);
  });

  it('"Card …A1B2 associata" from Associa card shows once and not after a new visit', async () => {
    const { router } = renderCustomer(setup(), '/');
    await act(async () => {
      await router.navigate(`/clienti/${MARIA.id}`, {
        state: { notice: 'Card …A1B2 associata.' },
      });
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Card …A1B2 associata.'),
    );
    await summaryLine('Card attiva …E5F6 · maria.rossi@example.com');

    // Away and back to the same page: no message any more.
    await act(async () => {
      await router.navigate('/');
    });
    await act(async () => {
      await router.navigate(`/clienti/${MARIA.id}`);
    });
    await summaryLine('Card attiva …E5F6 · maria.rossi@example.com');
    expect(screen.queryByText('Card …A1B2 associata.')).not.toBeInTheDocument();
    // Neither when the history entry it came with is visited again.
    await act(async () => {
      await router.navigate(-2);
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}`));
    await summaryLine('Card attiva …E5F6 · maria.rossi@example.com');
    expect(screen.queryByText('Card …A1B2 associata.')).not.toBeInTheDocument();
  });
});
