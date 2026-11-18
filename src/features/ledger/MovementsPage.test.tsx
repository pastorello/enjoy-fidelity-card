import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeCardsService } from '../../test/fakeCardsService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeLedgerService, fakeMovement } from '../../test/fakeLedgerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import type { Movement } from './types';

const MARIA = fakeCustomer({ name: 'Maria Rossi', balance: 20 });
const ROSA = fakeCustomer({ name: 'Rosa Bianchi', balance: 0 });
const ERASED = fakeCustomer({
  name: 'cancellato-7f3a',
  anonymizedAt: '2026-11-17T09:00:00.000Z',
  balance: 40,
});

// "Now" is 18 November 2026, 11:00 in Rome (10:00 UTC).
const NOW = new Date('2026-11-18T10:00:00.000Z');

/** The movements of the wireframe "Movimenti", given out of order. */
function wireframeMovements(): Movement[] {
  const redemption = fakeMovement({
    customerId: MARIA.id,
    kind: 'redemption',
    amountCents: null,
    centsPerPoint: null,
    points: -100,
    description: 'Cornetto e cappuccino',
    operatorName: 'Giulia',
    createdAt: '2026-11-18T09:45:00.000Z', // Oggi 10:45
  });
  const purchase = fakeMovement({
    customerId: MARIA.id,
    amountCents: 1250,
    points: 12,
    operatorName: 'Giulia',
    createdAt: '2026-11-18T09:42:00.000Z', // Oggi 10:42
  });
  const yesterday = fakeMovement({
    customerId: MARIA.id,
    amountCents: 3150,
    points: 31,
    operatorName: 'Andrea',
    createdAt: '2026-11-17T18:10:00.000Z', // Ieri 19:10
  });
  const cancelled = fakeMovement({
    customerId: MARIA.id,
    amountCents: 800,
    points: 8,
    operatorName: 'Andrea',
    createdAt: '2026-11-08T17:05:00.000Z', // 8 novembre 18:05
    cancelledById: '00000000-0000-4000-d000-00000000ffff',
    cancelledAt: '2026-11-08T17:12:00.000Z',
  });
  const correction = fakeMovement({
    customerId: MARIA.id,
    kind: 'correction',
    amountCents: null,
    centsPerPoint: null,
    points: -8,
    operatorName: 'Andrea',
    createdAt: '2026-11-08T17:12:00.000Z', // 8 novembre 18:12
    correctsMovementId: cancelled.id,
    correctedKind: 'purchase',
    correctedCreatedAt: cancelled.createdAt,
  });
  // Another customer's movement never shows in Maria's history.
  const other = fakeMovement({ customerId: ROSA.id, createdAt: '2026-11-18T08:00:00.000Z' });
  return [cancelled, yesterday, other, correction, purchase, redemption];
}

/** `count` purchases of Maria, one a minute back from today 10:59 in Rome. */
function manyPurchases(count: number): Movement[] {
  return Array.from({ length: count }, (_, index) =>
    fakeMovement({
      customerId: MARIA.id,
      amountCents: 100 * (index + 1),
      points: index + 1,
      operatorName: 'Giulia',
      createdAt: new Date(NOW.getTime() - (index + 1) * 60_000).toISOString(),
    }),
  );
}

function setup({ movements = wireframeMovements(), auth = signedInFake() } = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA, ROSA, ERASED] });
  const settings = createFakeSettingsService();
  const rewards = createFakeRewardsService();
  const ledger = createFakeLedgerService({ customers, rewards, settings, movements });
  const open = (id: string) =>
    renderApp(
      `/clienti/${id}/movimenti`,
      auth,
      settings,
      customers,
      rewards,
      createTestCardReader(),
      createFakeCardsService({ customers }),
      ledger,
    );
  return { auth, customers, ledger, open };
}

/** A row's text, with the no-break space of the amounts ("12,50 €") read as a space. */
function rowText(row: HTMLElement): string {
  return (row.textContent ?? '').replace(/ /g, ' ');
}

/** The day groups: their h2 title and the text of their rows. */
async function days() {
  const headings = await screen.findAllByRole('heading', { level: 2 });
  return headings.map((heading) => {
    const group = heading.closest('section');
    if (!group) throw new Error(`no section for ${heading.textContent ?? ''}`);
    return {
      title: heading.textContent,
      rows: within(group).getAllByRole('listitem').map(rowText),
    };
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MovementsPage: the history of a customer (/clienti/:id/movimenti)', () => {
  it('shows "Movimenti", Indietro to the customer page and the customer row', async () => {
    setup().open(MARIA.id);
    expect(await screen.findByRole('heading', { level: 1, name: 'Movimenti' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}`,
    );
    const customer = await screen.findByRole('link', { name: /Maria Rossi/ });
    expect(customer).toHaveAttribute('href', `/clienti/${MARIA.id}`);
    expect(customer).toHaveTextContent('20 pt');
  });

  it('groups by day (OGGI, IERI, 8 NOVEMBRE), newest first, rows with the time only (criterion 6)', async () => {
    const { ledger, open } = setup();
    open(MARIA.id);
    expect(await days()).toEqual([
      {
        title: 'OGGI',
        rows: ['Premio: Cornetto e cappuccino10:45 · Giulia−100', 'Spesa 12,50 €10:42 · Giulia+12'],
      },
      { title: 'IERI', rows: ['Spesa 31,50 €19:10 · Andrea+31'] },
      {
        title: '8 NOVEMBRE',
        rows: [
          'Correzione18:12 · Andrea · annulla la spesa delle 18:05−8',
          'Spesa 8,00 €18:05 · Andrea · annullata+8',
        ],
      },
    ]);
    expect(ledger.service.listMovements).toHaveBeenCalledWith(MARIA.id, { limit: 50 });
  });

  it('strikes through the text and the points of a cancelled movement, without a button', async () => {
    setup().open(MARIA.id);
    const group = (await screen.findByRole('heading', { level: 2, name: '8 NOVEMBRE' })).closest(
      'section',
    );
    if (!group) throw new Error('no 8 NOVEMBRE group');
    const [correction, cancelled] = within(group).getAllByRole('listitem');
    if (!correction || !cancelled) throw new Error('two rows expected');

    const struck = cancelled.querySelectorAll('s');
    expect([...struck].map((node) => rowText(node))).toEqual(['Spesa 8,00 €', '+8']);
    expect(cancelled).toHaveAttribute('data-cancelled', 'true');
    expect(correction.querySelectorAll('s')).toHaveLength(0);
    expect(correction).not.toHaveAttribute('data-cancelled');
    expect(within(group).queryByRole('button')).not.toBeInTheDocument();
  });

  it('names a redemption correction and a cancelled movement of another day', async () => {
    const redemption = fakeMovement({
      customerId: MARIA.id,
      kind: 'redemption',
      amountCents: null,
      centsPerPoint: null,
      points: -50,
      description: 'Caffè',
      operatorName: 'Giulia',
      createdAt: '2026-11-07T17:05:00.000Z', // 7 nov 18:05
      cancelledById: '00000000-0000-4000-d000-00000000fffe',
      cancelledAt: '2026-11-08T17:12:00.000Z',
    });
    const correction = fakeMovement({
      customerId: MARIA.id,
      kind: 'correction',
      amountCents: null,
      centsPerPoint: null,
      points: 50,
      operatorName: 'Andrea',
      createdAt: '2026-11-08T17:12:00.000Z',
      correctsMovementId: redemption.id,
      correctedKind: 'redemption',
      correctedCreatedAt: redemption.createdAt,
    });
    setup({ movements: [redemption, correction] }).open(MARIA.id);
    expect(await days()).toEqual([
      {
        title: '8 NOVEMBRE',
        rows: ['Correzione18:12 · Andrea · annulla il riscatto del 7 nov alle 18:05+50'],
      },
      { title: '7 NOVEMBRE', rows: ['Premio: Caffè18:05 · Giulia · annullata−50'] },
    ]);
  });

  it('adds the year to the day of another year', async () => {
    const old = fakeMovement({
      customerId: MARIA.id,
      amountCents: 500,
      points: 5,
      operatorName: 'Marco',
      createdAt: '2025-11-08T17:05:00.000Z',
    });
    setup({ movements: [old] }).open(MARIA.id);
    expect(await days()).toEqual([
      { title: '8 NOVEMBRE 2025', rows: ['Spesa 5,00 €18:05 · Marco+5'] },
    ]);
  });

  it('"Mostra altri" loads the next 50, older than the last shown, and goes when none are left', async () => {
    const movements = manyPurchases(60);
    const { ledger, open } = setup({ movements });
    open(MARIA.id);
    expect(await screen.findAllByRole('listitem')).toHaveLength(50);
    const more = screen.getByRole('button', { name: 'Mostra altri' });

    await userEvent.click(more);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(60));
    const fiftieth = movements[49];
    if (!fiftieth) throw new Error('60 movements expected');
    expect(ledger.service.listMovements).toHaveBeenLastCalledWith(MARIA.id, {
      limit: 50,
      before: { createdAt: fiftieth.createdAt, id: fiftieth.id },
    });
    // The rows keep their order across the pages, the oldest at the bottom.
    const rows = screen.getAllByRole('listitem').map(rowText);
    expect(rows.at(0)).toBe('Spesa 1,00 €10:59 · Giulia+1');
    expect(rows.at(-1)).toBe('Spesa 60,00 €10:00 · Giulia+60');
    expect(screen.queryByRole('button', { name: 'Mostra altri' })).not.toBeInTheDocument();
  });

  it('no "Mostra altri" when a page is not full', async () => {
    setup({ movements: manyPurchases(49) }).open(MARIA.id);
    expect(await screen.findAllByRole('listitem')).toHaveLength(49);
    expect(screen.queryByRole('button', { name: 'Mostra altri' })).not.toBeInTheDocument();
  });

  it('a page that brings nothing more removes "Mostra altri"', async () => {
    const { ledger, open } = setup({ movements: manyPurchases(50) });
    open(MARIA.id);
    expect(await screen.findAllByRole('listitem')).toHaveLength(50);
    await userEvent.click(screen.getByRole('button', { name: 'Mostra altri' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Mostra altri' })).not.toBeInTheDocument(),
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(ledger.service.listMovements).toHaveBeenCalledTimes(2);
  });

  it('"Mostra altri" that fails keeps the rows and says so; tapping again loads them', async () => {
    const { ledger, open } = setup({ movements: manyPurchases(60) });
    open(MARIA.id);
    expect(await screen.findAllByRole('listitem')).toHaveLength(50);
    ledger.failNext('listMovements', 'network');
    await userEvent.click(screen.getByRole('button', { name: 'Mostra altri' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Non riesco a caricare altri movimenti',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(50);

    await userEvent.click(screen.getByRole('button', { name: 'Mostra altri' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(60));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a customer without movements: "Ancora nessun movimento"', async () => {
    setup({ movements: [] }).open(ROSA.id);
    expect(await screen.findByText('Ancora nessun movimento')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mostra altri' })).not.toBeInTheDocument();
  });

  it('a failed load: "Movimenti non caricati" with "Riprova", which loads them', async () => {
    const { ledger, open } = setup();
    ledger.failNext('listMovements', 'network');
    open(MARIA.id);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Movimenti non caricati' })).toBeVisible();
    expect(alert).toHaveTextContent('Controlla la connessione e riprova.');

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(ledger.service.listMovements).toHaveBeenCalledTimes(2);
  });

  it('a customer that does not exist: "Cliente non trovato" and "Torna all’inizio"', async () => {
    setup().open('00000000-0000-4000-8000-00000000dead');
    expect(await screen.findByRole('heading', { name: 'Cliente non trovato' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Torna all’inizio' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('a customer that cannot be loaded: "Cliente non caricato" with "Riprova"', async () => {
    const { customers, open } = setup();
    customers.failNext('get', 'network');
    open(MARIA.id);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Cliente non caricato' })).toBeVisible();
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
    expect(await screen.findAllByRole('listitem')).toHaveLength(5);
  });

  it('an erased customer: "Cliente cancellato" and the history stays', async () => {
    const movement = fakeMovement({
      customerId: ERASED.id,
      amountCents: 4000,
      points: 40,
      operatorName: 'Giulia',
      createdAt: '2026-11-18T08:42:00.000Z', // Oggi 09:42
    });
    setup({ movements: [movement] }).open(ERASED.id);
    expect(await screen.findByRole('link', { name: /Cliente cancellato/ })).toBeInTheDocument();
    expect(screen.queryByText('cancellato-7f3a')).not.toBeInTheDocument();
    expect(await days()).toEqual([{ title: 'OGGI', rows: ['Spesa 40,00 €09:42 · Giulia+40'] }]);
  });

  it('forbidden from the ledger: back to /accedi', async () => {
    const auth = signedInFake();
    const { ledger, open } = setup({ auth });
    ledger.failNext('listMovements', 'forbidden');
    const held = ledger.holdNext('listMovements');
    const { router } = open(MARIA.id);
    await screen.findByRole('heading', { level: 1, name: 'Movimenti' });
    auth.removeProfile();
    held.release();
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });
});
