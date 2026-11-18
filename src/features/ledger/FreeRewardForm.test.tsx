import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createFakeCardsService } from '../../test/fakeCardsService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeLedgerService } from '../../test/fakeLedgerService';
import { createFakeRewardsService, fakeReward } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const MARIA = fakeCustomer({ name: 'Maria Rossi', phone: '+393330004521', balance: 120 });
const FREE_PATH = `/clienti/${MARIA.id}/premi?libero`;

function renderFree(path = FREE_PATH) {
  const customers = createFakeCustomerService({ customers: [MARIA] });
  const rewards = createFakeRewardsService({
    rewards: [fakeReward({ name: 'Caffè', points: 50 })],
  });
  const settings = createFakeSettingsService();
  const ledger = createFakeLedgerService({ customers, rewards, settings });
  renderApp(
    path,
    signedInFake(),
    settings,
    customers,
    rewards,
    createTestCardReader(),
    createFakeCardsService({ customers }),
    ledger,
  );
  return { ledger };
}

async function ready() {
  return screen.findByRole('textbox', { name: 'Descrizione del premio' });
}

function pointsOutput() {
  return within(screen.getByRole('region', { name: 'Punti da scalare' })).getByRole('status');
}

/** Presses the keypad digits one after the other. */
async function typePoints(digits: string) {
  const keypad = screen.getByRole('group', { name: 'Tastierino numerico' });
  await digits
    .split('')
    .reduce<Promise<void>>(
      (previous, digit) =>
        previous.then(() => userEvent.click(within(keypad).getByRole('button', { name: digit }))),
      Promise.resolve(),
    );
}

function redeemButton() {
  return screen.getByRole('button', { name: /^Riscatta/ });
}

describe('FreeRewardForm: Premio libero', () => {
  it('header, customer row, description, PUNTI DA SCALARE and a keypad without "00"', async () => {
    renderFree();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Premio libero' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/premi`,
    );
    const row = await screen.findByRole('link', { name: /Maria Rossi/ });
    expect(row).toHaveTextContent('120 pt');

    const description = await ready();
    expect(description).toHaveAttribute('placeholder', 'Es. dolce del giorno');
    expect(description).toHaveValue('');
    expect(screen.getByRole('region', { name: 'Punti da scalare' })).toHaveTextContent(
      'PUNTI DA SCALARE',
    );
    expect(pointsOutput()).toHaveTextContent('0');

    const keypad = screen.getByRole('group', { name: 'Tastierino numerico' });
    expect(within(keypad).queryByRole('button', { name: 'Doppio zero' })).not.toBeInTheDocument();
    expect(keypad).toHaveAttribute('data-variant', 'points');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(redeemButton()).toHaveAccessibleName('Riscatta');
    expect(redeemButton()).toBeDisabled();
  });

  it('points from 1 to 99.999: extra digits are ignored', async () => {
    renderFree();
    await ready();
    await typePoints('1234567');
    expect(pointsOutput()).toHaveTextContent('12.345');
    await userEvent.click(screen.getByRole('button', { name: 'Cancella ultima cifra' }));
    expect(pointsOutput()).toHaveTextContent('1.234');
  });

  it('above the balance: "Saldo insufficiente" with the first name, tied to the output; button disabled', async () => {
    renderFree();
    await userEvent.type(await ready(), 'Dolce del giorno');
    await typePoints('150');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Saldo insufficiente: Maria ha 120 punti e il saldo non può scendere sotto zero.',
    );
    expect(pointsOutput()).toHaveAttribute('aria-describedby', alert.id);
    expect(pointsOutput()).toHaveAccessibleDescription(
      'Saldo insufficiente: Maria ha 120 punti e il saldo non può scendere sotto zero.',
    );
    expect(redeemButton()).toHaveAccessibleName('Riscatta 150 punti');
    expect(redeemButton()).toBeDisabled();

    // Exactly the balance is allowed (balance 0 after).
    await userEvent.click(screen.getByRole('button', { name: 'Cancella ultima cifra' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancella ultima cifra' }));
    await typePoints('20');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(pointsOutput()).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('button', { name: 'Riscatta 120 punti' })).toBeEnabled();
  });

  it('disabled with an empty (or blank) description, and with 0 points ("Riscatta")', async () => {
    renderFree();
    const description = await ready();
    await typePoints('50');
    expect(screen.getByRole('button', { name: 'Riscatta 50 punti' })).toBeDisabled();

    await userEvent.type(description, '   ');
    expect(screen.getByRole('button', { name: 'Riscatta 50 punti' })).toBeDisabled();

    await userEvent.type(description, 'Dolce');
    expect(screen.getByRole('button', { name: 'Riscatta 50 punti' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancella ultima cifra' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancella ultima cifra' }));
    expect(pointsOutput()).toHaveTextContent('0');
    expect(redeemButton()).toHaveAccessibleName('Riscatta');
    expect(redeemButton()).toBeDisabled();
  });

  it('the description accepts at most 80 characters', async () => {
    renderFree();
    const description = await ready();
    expect(description).toHaveAttribute('maxlength', '80');
  });

  it('"Riscatta N punti" sends the trimmed description and the points once', async () => {
    const { ledger } = renderFree();
    await userEvent.type(await ready(), '  Dolce del giorno  ');
    await typePoints('100');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Riscatta 100 punti' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Premio riscattato' }),
    ).toBeInTheDocument();
    expect(ledger.service.redeemFreeReward).toHaveBeenCalledTimes(1);
    expect(ledger.service.redeemFreeReward).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: MARIA.id,
        description: 'Dolce del giorno',
        points: 100,
      }),
    );
    expect(ledger.service.redeemReward).not.toHaveBeenCalled();
    expect(ledger.movements()).toHaveLength(1);
  });

  it('"Indietro" goes back to the catalog (opened directly)', async () => {
    renderFree();
    await ready();
    await userEvent.click(screen.getByRole('link', { name: 'Indietro' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Riscatta premio' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'CATALOGO' })).toBeInTheDocument();
  });

  it('"Premio libero" from the catalog opens the form; "Indietro" returns to the catalog', async () => {
    renderFree(`/clienti/${MARIA.id}/premi`);
    await screen.findByRole('group', { name: 'CATALOGO' });
    await userEvent.click(screen.getByRole('link', { name: /Premio libero/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Premio libero' }),
    ).toBeInTheDocument();
    await ready();

    await userEvent.click(screen.getByRole('link', { name: 'Indietro' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Riscatta premio' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'CATALOGO' })).toBeInTheDocument();
  });

  it('insufficient-balance from the server (changed meanwhile): the balance reloads', async () => {
    const { ledger } = renderFree();
    await userEvent.type(await ready(), 'Dolce');
    await typePoints('100');
    // Another operator spends 50 points meanwhile.
    await ledger.service.redeemFreeReward({
      operationId: 'other-operator',
      customerId: MARIA.id,
      description: 'Caffè',
      points: 50,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Riscatta 100 punti' }));

    expect(
      await screen.findByText(
        'Saldo insufficiente: Maria ha 70 punti e il saldo non può scendere sotto zero.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riscatta 100 punti' })).toBeDisabled();
    expect(ledger.movements()).toHaveLength(1);
  });
});
