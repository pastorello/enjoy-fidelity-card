import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeCardsService } from '../../test/fakeCardsService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeLedgerService, fakeMovement } from '../../test/fakeLedgerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { stubLayout } from '../../test/stubLayout';

// SPEC-tablet-kiosk, point 10 (wireframe "Tablet: scheda cliente"): SALDO and the actions on the
// left (560 px), ULTIMI MOVIMENTI on the right. Same texts, roles and links as on the phone.
// Invented customers only.

const MARIA = fakeCustomer({
  name: 'Maria Rossi',
  email: 'maria.rossi@example.com',
  notes: 'Preferisce il caffè d’orzo',
  balance: 120,
});
const ERASED = fakeCustomer({
  name: 'cancellato-7f3a',
  email: null,
  notes: null,
  anonymizedAt: '2026-11-17T09:00:00.000Z',
  balance: 40,
});

function open(id: string) {
  const customers = createFakeCustomerService({ customers: [MARIA, ERASED] });
  const settings = createFakeSettingsService();
  const rewards = createFakeRewardsService();
  const ledger = createFakeLedgerService({
    customers,
    rewards,
    settings,
    movements: [
      fakeMovement({ customerId: id, amountCents: 1500, points: 15, operatorName: 'Giulia' }),
    ],
  });
  return renderApp(
    `/clienti/${id}`,
    signedInFake(),
    settings,
    customers,
    rewards,
    createTestCardReader(),
    createFakeCardsService({ customers }),
    ledger,
  );
}

function column(name: 'customer' | 'movements'): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-tablet-column="${name}"]`);
  if (!found) throw new Error(`no ${name} column`);
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CustomerPage at 1280×800 (wireframe "Tablet: scheda cliente")', () => {
  it('SALDO and the actions on the left, ULTIMI MOVIMENTI with "Vedi tutti" on the right', async () => {
    stubLayout(true);
    open(MARIA.id);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Maria Rossi' }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-tablet="true"]')).not.toBeNull();

    const left = column('customer');
    expect(await within(left).findByText(/· maria\.rossi@example\.com$/)).toBeInTheDocument();
    expect(document.querySelector('[href^="mailto:" i]')).toBeNull();
    expect(within(left).getByText('Preferisce il caffè d’orzo')).toBeInTheDocument();
    expect(within(left).getByRole('region', { name: 'SALDO' })).toHaveTextContent('120');
    expect(within(left).getByRole('link', { name: 'Registra spesa' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/spesa`,
    );
    expect(within(left).getByRole('link', { name: 'Riscatta premio' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/premi`,
    );
    expect(within(left).queryByRole('region', { name: 'ULTIMI MOVIMENTI' })).toBeNull();

    const right = column('movements');
    const movements = within(right).getByRole('region', { name: 'ULTIMI MOVIMENTI' });
    expect(within(movements).getByRole('link', { name: 'Vedi tutti' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/movimenti`,
    );
    expect(await within(movements).findByText('Spesa 15,00 €')).toBeInTheDocument();
    expect(within(right).queryByRole('region', { name: 'SALDO' })).toBeNull();
  });

  it('an erased customer: "Dati cancellati" and SALDO on the left, no actions, the movements on the right', async () => {
    stubLayout(true);
    open(ERASED.id);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Cliente cancellato' }),
    ).toBeInTheDocument();
    const left = column('customer');
    expect(within(left).getByText(/^Dati cancellati il /)).toBeInTheDocument();
    expect(within(left).getByRole('region', { name: 'SALDO' })).toHaveTextContent('40');
    expect(screen.queryByRole('link', { name: 'Registra spesa' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Riscatta premio' })).toBeNull();
    expect(
      within(column('movements')).getByRole('region', { name: 'ULTIMI MOVIMENTI' }),
    ).toBeInTheDocument();
  });

  it('on the phone the page keeps one column: no tablet columns', async () => {
    stubLayout(false);
    open(MARIA.id);
    expect(await screen.findByRole('region', { name: 'ULTIMI MOVIMENTI' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registra spesa' })).toBeInTheDocument();
    expect(document.querySelector('[data-tablet]')).toBeNull();
    expect(document.querySelector('[data-tablet-column]')).toBeNull();
  });
});
