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

const MARIA = fakeCustomer({ name: 'Maria Rossi', balance: 120 });
const ROSA = fakeCustomer({ name: 'Rosa Bianchi', balance: 0 });
const ERASED = fakeCustomer({
  name: 'cancellato-7f3a',
  anonymizedAt: '2026-11-17T09:00:00.000Z',
  balance: 40,
});

// "Now" is 18 November 2026, 10:00 in Rome (09:00 UTC).
const NOW = new Date('2026-11-18T09:00:00.000Z');

/** The wireframe "Scheda cliente", plus an older purchase that must not be shown, given out of order. */
function mariaMovements(): Movement[] {
  const oldest = fakeMovement({
    customerId: MARIA.id,
    amountCents: 500,
    points: 5,
    operatorName: 'Marco',
    createdAt: '2026-10-20T08:00:00.000Z',
  });
  const purchase = fakeMovement({
    customerId: MARIA.id,
    amountCents: 1500,
    points: 15,
    operatorName: 'Giulia',
    createdAt: '2026-11-17T18:10:00.000Z', // Ieri 19:10 in Rome
  });
  const redemption = fakeMovement({
    customerId: MARIA.id,
    kind: 'redemption',
    amountCents: null,
    centsPerPoint: null,
    points: -50,
    description: 'Caffè',
    operatorName: 'Andrea',
    createdAt: '2026-11-08T17:20:00.000Z', // 8 nov 18:20
  });
  const cancelled = fakeMovement({
    customerId: MARIA.id,
    amountCents: 2300,
    points: 23,
    operatorName: 'Marco',
    createdAt: '2026-11-02T10:30:00.000Z', // 2 nov 11:30
    cancelledById: '00000000-0000-4000-d000-00000000ffff',
    cancelledAt: '2026-11-02T10:30:05.000Z',
  });
  const correction = fakeMovement({
    customerId: MARIA.id,
    kind: 'correction',
    amountCents: null,
    centsPerPoint: null,
    points: -23,
    operatorName: 'Marco',
    createdAt: '2026-11-02T10:30:05.000Z',
    correctsMovementId: cancelled.id,
    correctedKind: 'purchase',
    correctedCreatedAt: cancelled.createdAt,
  });
  // Another customer's movement never shows on Maria's page.
  const other = fakeMovement({ customerId: ROSA.id, createdAt: '2026-11-18T08:00:00.000Z' });
  return [cancelled, oldest, redemption, purchase, correction, other];
}

function renderCustomer(id: string, { movements = mariaMovements(), auth = signedInFake() } = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA, ROSA, ERASED] });
  const settings = createFakeSettingsService();
  const rewards = createFakeRewardsService();
  const ledger = createFakeLedgerService({ customers, rewards, settings, movements });
  const rendered = renderApp(
    `/clienti/${id}`,
    auth,
    settings,
    customers,
    rewards,
    createTestCardReader(),
    createFakeCardsService({ customers }),
    ledger,
  );
  return { ...rendered, auth, ledger };
}

/** A row's text, with the no-break space of the amounts ("15,00 €") read as a space. */
function rowText(row: HTMLElement): string {
  return (row.textContent ?? '').replace(/\u00a0/g, ' ');
}

/** Whether `b` comes after `a` in the document. */
function follows(a: Node, b: Node): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function lastMovements() {
  return screen.findByRole('region', { name: 'ULTIMI MOVIMENTI' });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CustomerLedgerSection: buttons and ULTIMI MOVIMENTI in the Scheda cliente', () => {
  it('shows "Registra spesa" (primary) and "Riscatta premio" (secondary) to the till screens', async () => {
    renderCustomer(MARIA.id);
    const purchase = await screen.findByRole('link', { name: 'Registra spesa' });
    expect(purchase).toHaveAttribute('href', `/clienti/${MARIA.id}/spesa`);
    expect(purchase).toHaveAttribute('data-variant', 'primary');
    const redeem = screen.getByRole('link', { name: 'Riscatta premio' });
    expect(redeem).toHaveAttribute('href', `/clienti/${MARIA.id}/premi`);
    expect(redeem).toHaveAttribute('data-variant', 'secondary');
  });

  it('lists the 4 newest movements, newest first, with relative date, operator, signed points', async () => {
    const { ledger } = renderCustomer(MARIA.id);
    const section = await lastMovements();
    expect(
      within(section).getByRole('heading', { level: 2, name: 'ULTIMI MOVIMENTI' }),
    ).toBeVisible();

    const rows = await within(section).findAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows.map(rowText)).toEqual([
      'Spesa 15,00 €Ieri 19:10 · Giulia+15',
      'Premio: Caffè8 nov 18:20 · Andrea−50',
      'Correzione2 nov 11:30 · Marco−23',
      'Spesa 23,00 €2 nov 11:30 · Marco · annullata+23',
    ]);
    // Rows are not interactive: nothing to tap inside the list.
    const list = within(section).getByRole('list');
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
    expect(within(list).queryByRole('button')).not.toBeInTheDocument();

    expect(within(section).getByRole('link', { name: 'Vedi tutti' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/movimenti`,
    );
    expect(ledger.service.listMovements).toHaveBeenCalledWith(MARIA.id, { limit: 4 });
  });

  it('a customer without movements: "Ancora nessun movimento"', async () => {
    renderCustomer(ROSA.id, { movements: [] });
    const section = await lastMovements();
    expect(await within(section).findByText('Ancora nessun movimento')).toBeInTheDocument();
    expect(within(section).queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registra spesa' })).toBeInTheDocument();
  });

  it('a failed load: compact row "Non riesco a caricare i movimenti" with "Riprova"', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    const settings = createFakeSettingsService();
    const rewards = createFakeRewardsService();
    const ledger = createFakeLedgerService({
      customers,
      rewards,
      settings,
      movements: mariaMovements(),
    });
    ledger.failNext('listMovements', 'network');
    renderApp(
      `/clienti/${MARIA.id}`,
      signedInFake(),
      settings,
      customers,
      rewards,
      createTestCardReader(),
      createFakeCardsService({ customers }),
      ledger,
    );
    const section = await lastMovements();
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent('Non riesco a caricare i movimenti');
    // The buttons do not depend on the movements.
    expect(screen.getByRole('link', { name: 'Registra spesa' })).toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await within(section).findAllByRole('listitem')).toHaveLength(4);
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument();
    expect(ledger.service.listMovements).toHaveBeenCalledTimes(2);
  });

  it('an erased customer: no "Registra spesa" or "Riscatta premio", the movements stay', async () => {
    const movement = fakeMovement({
      customerId: ERASED.id,
      amountCents: 4000,
      points: 40,
      operatorName: 'Giulia',
      createdAt: '2026-11-18T08:42:00.000Z', // Oggi 09:42
    });
    renderCustomer(ERASED.id, { movements: [movement] });
    const section = await lastMovements();
    const rows = await within(section).findAllByRole('listitem');
    expect(rows.map(rowText)).toEqual(['Spesa 40,00 €Oggi 09:42 · Giulia+40']);
    expect(screen.queryByRole('link', { name: 'Registra spesa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Riscatta premio' })).not.toBeInTheDocument();
  });

  it('sits below the SALDO block, buttons before ULTIMI MOVIMENTI', async () => {
    renderCustomer(MARIA.id);
    const section = await lastMovements();
    const balance = screen.getByRole('region', { name: 'SALDO' });
    const purchase = screen.getByRole('link', { name: 'Registra spesa' });
    expect(follows(balance, purchase)).toBe(true);
    expect(follows(purchase, section)).toBe(true);
  });

  it('forbidden from the ledger: back to /accedi', async () => {
    const auth = signedInFake();
    const customers = createFakeCustomerService({ customers: [MARIA] });
    const settings = createFakeSettingsService();
    const rewards = createFakeRewardsService();
    const ledger = createFakeLedgerService({ customers, rewards, settings });
    // The account loses its profile while the movements are on their way.
    ledger.failNext('listMovements', 'forbidden');
    const held = ledger.holdNext('listMovements');
    const { router } = renderApp(
      `/clienti/${MARIA.id}`,
      auth,
      settings,
      customers,
      rewards,
      createTestCardReader(),
      createFakeCardsService({ customers }),
      ledger,
    );
    await lastMovements();
    auth.removeProfile();
    held.release();
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });
});
