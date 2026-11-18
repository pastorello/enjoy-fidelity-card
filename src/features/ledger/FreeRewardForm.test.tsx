import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const rendered = renderApp(
    path,
    signedInFake(),
    settings,
    customers,
    rewards,
    createTestCardReader(),
    createFakeCardsService({ customers }),
    ledger,
  );
  return { ...rendered, ledger };
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

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Types "Dolce del giorno" and 100 points, then redeems with fake timers at 10:45 in Rome. */
async function redeemDolce() {
  await userEvent.type(await ready(), 'Dolce del giorno');
  await typePoints('100');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T09:45:00.000Z'));
  fireEvent.click(screen.getByRole('button', { name: 'Riscatta 100 punti' }));
  await advance(0);
}

/** The operation ids of the free redemptions sent, in order. */
function freeIds(ledger: ReturnType<typeof createFakeLedgerService>) {
  return ledger.service.redeemFreeReward.mock.calls.map(([input]) => input.operationId);
}

describe('FreeRewardForm: Premio riscattato', () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('the texts of the wireframe Premio-ok with the description, the vibration, back to / after 10 s', async () => {
    const vibrate = vi.fn<(pattern: VibratePattern) => boolean>(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const { ledger, router } = renderFree();
    await redeemDolce();

    expect(screen.getByRole('heading', { level: 1, name: 'Premio riscattato' })).toHaveFocus();
    expect(screen.getByText('Dolce del giorno per Maria Rossi · −100 punti')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('20 punti');
    expect(screen.getByText('Oggi 10:45 · Giulia Prova')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla il riscatto · 10 s' })).toBeEnabled();
    expect(vibrate).toHaveBeenCalledWith(200);

    await advance(10_000);
    expect(router.state.location.pathname).toBe('/');
    expect(ledger.movements()).toHaveLength(1);
  });

  it('"Annulla il riscatto": "Riscatto annullato" and the balance back to 120', async () => {
    const { ledger } = renderFree();
    await redeemDolce();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla il riscatto · 10 s' }));
    await advance(0);

    expect(screen.getByRole('heading', { level: 1, name: 'Riscatto annullato' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('120 punti');
    expect(ledger.movements().map((movement) => movement.points)).toEqual([-100, 100]);
  });
});

describe('FreeRewardForm: Riscatto non salvato', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('network down: the alert, the values kept, "Riprova" with the same id (criterion 4)', async () => {
    const { ledger } = renderFree();
    ledger.setNetworkDown(true);
    await redeemDolce();

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Riscatto non salvato',
    );
    expect(alert).toHaveTextContent(
      'Il telefono non è connesso a internet. Riprova appena torna la rete: il riscatto non verrà registrato due volte.',
    );
    expect(screen.getByRole('textbox', { name: 'Descrizione del premio' })).toHaveValue(
      'Dolce del giorno',
    );
    expect(screen.getByRole('link', { name: 'Annulla' })).toHaveAttribute('href', '/');
    expect(ledger.movements()).toHaveLength(0);

    ledger.setNetworkDown(false);
    fireEvent.click(screen.getByRole('button', { name: 'Riprova 100 punti' }));
    await advance(0);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Premio riscattato' }),
    ).toBeInTheDocument();
    const ids = freeIds(ledger);
    expect(ids).toEqual([ids[0], ids[0]]);
    expect(ledger.movements()).toHaveLength(1);
  });

  it('answer lost after the write: "Riprova" gives the first result, a single redemption (criterion 4)', async () => {
    const { ledger } = renderFree();
    ledger.failNext('redeemFreeReward', 'lost');
    await redeemDolce();
    expect(screen.getByRole('alert')).toHaveTextContent('Riscatto non salvato');
    expect(ledger.movements()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Riprova 100 punti' }));
    await advance(0);

    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('20 punti');
    const ids = freeIds(ledger);
    expect(ids).toEqual([ids[0], ids[0]]);
    expect(ledger.movements()).toHaveLength(1);
  });
});
