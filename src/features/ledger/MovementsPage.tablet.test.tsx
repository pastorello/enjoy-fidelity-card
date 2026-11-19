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

// SPEC-tablet-kiosk, point 10 (wireframe "Tablet: movimenti del cliente"): one wide column with
// the customer row and the days, the same texts and controls as on the phone. Invented data only.

const MARIA = fakeCustomer({ name: 'Maria Rossi', balance: 20 });

function open() {
  const customers = createFakeCustomerService({ customers: [MARIA] });
  const settings = createFakeSettingsService();
  const rewards = createFakeRewardsService();
  const ledger = createFakeLedgerService({
    customers,
    rewards,
    settings,
    movements: [
      fakeMovement({ customerId: MARIA.id, amountCents: 1250, points: 12, operatorName: 'Giulia' }),
    ],
  });
  return renderApp(
    `/clienti/${MARIA.id}/movimenti`,
    signedInFake(),
    settings,
    customers,
    rewards,
    createTestCardReader(),
    createFakeCardsService({ customers }),
    ledger,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MovementsPage at 1280×800 (wireframe "Tablet: movimenti del cliente")', () => {
  it('one wide column with the customer row, the days and "Annulla" of the administrator', async () => {
    stubLayout(true);
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Movimenti' })).toBeInTheDocument();
    const wide = await screen.findByTestId('movements-column');
    expect(wide).toHaveAttribute('data-tablet', 'true');
    expect(await within(wide).findByText('Spesa 12,50 €')).toBeInTheDocument();
    expect(within(wide).getByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
    expect(within(wide).getByRole('button', { name: /Annulla/ })).toBeInTheDocument();
  });

  it('on the phone the page is unchanged: no tablet column', async () => {
    stubLayout(false);
    open();
    expect(await screen.findByText('Spesa 12,50 €')).toBeInTheDocument();
    expect(screen.queryByTestId('movements-column')).toBeNull();
    expect(document.querySelector('[data-tablet]')).toBeNull();
  });
});
