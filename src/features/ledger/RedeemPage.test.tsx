import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { fakeOperator } from '../../test/fakeAuthService';
import { createFakeCardsService } from '../../test/fakeCardsService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeLedgerService } from '../../test/fakeLedgerService';
import { createFakeRewardsService, fakeReward } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const MARIA = fakeCustomer({ name: 'Maria Rossi', phone: '+393330004521', balance: 120 });
const ERASED = fakeCustomer({
  name: 'cancellato-7f3a',
  anonymizedAt: '2026-11-17T09:00:00.000Z',
  balance: 40,
});
const MISSING_ID = '00000000-0000-4000-8000-00000000dead';

// The catalog of the wireframe "Riscatta premio", given out of order, plus an inactive reward.
const COLAZIONE = fakeReward({ name: 'Colazione per due', points: 180 });
const CAFFE = fakeReward({ name: 'Caffè', points: 50 });
const APERITIVO = fakeReward({ name: 'Aperitivo', points: 200 });
const CORNETTO = fakeReward({ name: 'Cornetto e cappuccino', points: 100 });
const SPENTO = fakeReward({ name: 'Premio spento', points: 10, active: false });
const CATALOG = [COLAZIONE, CAFFE, APERITIVO, CORNETTO, SPENTO];

type Options = {
  path?: string;
  auth?: ReturnType<typeof signedInFake>;
  customers?: ReturnType<typeof createFakeCustomerService>;
  rewards?: ReturnType<typeof createFakeRewardsService>;
};

function renderRedeem({
  path = `/clienti/${MARIA.id}/premi`,
  auth = signedInFake(),
  customers = createFakeCustomerService({ customers: [MARIA, ERASED] }),
  rewards = createFakeRewardsService({ rewards: CATALOG }),
}: Options = {}) {
  const settings = createFakeSettingsService();
  const ledger = createFakeLedgerService({ customers, rewards, settings });
  const rendered = renderApp(
    path,
    auth,
    settings,
    customers,
    rewards,
    createTestCardReader(),
    createFakeCardsService({ customers }),
    ledger,
  );
  return { ...rendered, auth, customers, rewards, ledger };
}

function catalog() {
  return screen.getByRole('group', { name: 'CATALOGO' });
}

async function ready() {
  return screen.findByRole('group', { name: 'CATALOGO' });
}

function redeemButton() {
  return screen.getByRole('button', { name: /^Riscatta/ });
}

/** The operation ids of the redemptions sent, in order. */
function sentIds(ledger: ReturnType<typeof createFakeLedgerService>) {
  return ledger.service.redeemReward.mock.calls.map(([input]) => input.operationId);
}

describe('RedeemPage: Riscatta premio', () => {
  it('header, the customer row, CATALOGO with the active rewards in order and "Premio libero"', async () => {
    renderRedeem();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Riscatta premio' }),
    ).toBeInTheDocument();
    const row = await screen.findByRole('link', { name: /Maria Rossi/ });
    expect(row).toHaveAttribute('href', `/clienti/${MARIA.id}`);
    expect(row).toHaveTextContent('120 pt');

    await ready();
    const radios = within(catalog()).getAllByRole('radio');
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([
      expect.stringContaining('Caffè'),
      expect.stringContaining('Cornetto e cappuccino'),
      expect.stringContaining('Colazione per due'),
      expect.stringContaining('Aperitivo'),
    ]);
    expect(screen.queryByText('Premio spento')).not.toBeInTheDocument();
    expect(within(catalog()).getByRole('radio', { name: /Caffè/ })).toHaveAccessibleName(
      /50 punti/,
    );
    expect(within(catalog()).getByText('100 pt')).toBeInTheDocument();

    const free = screen.getByRole('link', { name: /Premio libero/ });
    expect(free).toHaveAttribute('href', `/clienti/${MARIA.id}/premi?libero`);
    expect(free).toHaveTextContent('Descrizione e punti decisi al momento');
  });

  it('rewards above the balance stay visible but disabled, with "Mancano N punti"', async () => {
    renderRedeem();
    await ready();
    expect(screen.getByRole('radio', { name: /Caffè/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /Cornetto e cappuccino/ })).toBeEnabled();
    const colazione = screen.getByRole('radio', { name: /Colazione per due/ });
    expect(colazione).toBeDisabled();
    expect(colazione).toHaveAccessibleName(/Mancano 60 punti/);
    const aperitivo = screen.getByRole('radio', { name: /Aperitivo/ });
    expect(aperitivo).toBeDisabled();
    expect(aperitivo).toHaveAccessibleName(/Mancano 80 punti/);
    expect(screen.getAllByText(/^Mancano \d+ punti$/)).toHaveLength(2);
  });

  it('a reward worth exactly the balance can be chosen (balance after 0)', async () => {
    const exact = fakeReward({ name: 'Esatto', points: 120 });
    renderRedeem({ rewards: createFakeRewardsService({ rewards: [exact] }) });
    await ready();
    await userEvent.click(screen.getByRole('radio', { name: /Esatto/ }));
    expect(screen.getByText('Saldo dopo il riscatto').parentElement).toHaveTextContent(
      'Saldo dopo il riscatto0 punti',
    );
    expect(screen.getByRole('button', { name: 'Riscatta 120 punti' })).toBeEnabled();
  });

  it('"Riscatta" is disabled until a reward is chosen; then the balance after and "Riscatta N punti"', async () => {
    renderRedeem();
    await ready();
    expect(redeemButton()).toHaveAccessibleName('Riscatta');
    expect(redeemButton()).toBeDisabled();
    expect(screen.queryByText('Saldo dopo il riscatto')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Cornetto e cappuccino/ }));
    expect(screen.getByRole('radio', { name: /Cornetto e cappuccino/ })).toBeChecked();
    expect(screen.getByText('Saldo dopo il riscatto').parentElement).toHaveTextContent(
      'Saldo dopo il riscatto20 punti',
    );
    expect(screen.getByRole('button', { name: 'Riscatta 100 punti' })).toBeEnabled();

    await userEvent.click(screen.getByRole('radio', { name: /Caffè/ }));
    expect(screen.getByText('Saldo dopo il riscatto').parentElement).toHaveTextContent(
      'Saldo dopo il riscatto70 punti',
    );
    expect(screen.getByRole('button', { name: 'Riscatta 50 punti' })).toBeEnabled();
  });

  it('"Riscatta N punti" redeems the chosen reward once, then "Premio riscattato"', async () => {
    const { ledger } = renderRedeem();
    await ready();
    await userEvent.click(screen.getByRole('radio', { name: /Cornetto e cappuccino/ }));
    await userEvent.dblClick(screen.getByRole('button', { name: 'Riscatta 100 punti' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Premio riscattato' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Cornetto e cappuccino per Maria Rossi · −100 punti')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('20 punti');
    expect(ledger.service.redeemReward).toHaveBeenCalledTimes(1);
    expect(ledger.service.redeemReward).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: MARIA.id, rewardId: CORNETTO.id }),
    );
    expect(ledger.movements()).toHaveLength(1);
  });

  it('an empty catalog: "Nessun premio nel catalogo" and "Premio libero" stays', async () => {
    renderRedeem({ rewards: createFakeRewardsService() });
    expect(await screen.findByText('Nessun premio nel catalogo')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Premio libero/ })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/premi?libero`,
    );
    expect(screen.queryByRole('button', { name: /^Riscatta/ })).not.toBeInTheDocument();
  });

  it('a catalog load error: "Riprova" loads again and "Premio libero" stays available', async () => {
    const rewards = createFakeRewardsService({ rewards: CATALOG });
    rewards.failNext('listActive', 'network');
    renderRedeem({ rewards });
    expect(await screen.findByText('Catalogo non caricato')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Premio libero/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Riscatta/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await ready();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(rewards.service.listActive).toHaveBeenCalledTimes(2);
  });
});

describe('RedeemPage: refusals that reload', () => {
  it('reward-unavailable: "Premio non più disponibile", the catalog reloads and the id is discarded', async () => {
    const rewards = createFakeRewardsService({ rewards: CATALOG });
    const { ledger } = renderRedeem({ rewards });
    await ready();
    await userEvent.click(screen.getByRole('radio', { name: /Cornetto e cappuccino/ }));
    // Another admin switches it off meanwhile.
    await rewards.service.setActive(CORNETTO.id, false);
    await userEvent.click(screen.getByRole('button', { name: 'Riscatta 100 punti' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Premio non più disponibile');
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: /Cornetto/ })).not.toBeInTheDocument(),
    );
    expect(rewards.service.listActive).toHaveBeenCalledTimes(2);
    expect(redeemButton()).toBeDisabled();
    expect(screen.queryByText('Saldo dopo il riscatto')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Caffè/ }));
    expect(screen.queryByText('Premio non più disponibile')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riscatta 50 punti' }));
    await screen.findByRole('heading', { level: 1, name: 'Premio riscattato' });

    const ids = sentIds(ledger);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
    expect(ledger.movements()).toHaveLength(1);
  });

  it('insufficient-balance: the message, the balance reloaded and the id discarded', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA, ERASED] });
    const { ledger } = renderRedeem({ customers });
    await ready();
    await userEvent.click(screen.getByRole('radio', { name: /Cornetto e cappuccino/ }));
    // Another operator spends 60 points of Maria meanwhile.
    customers.applyMovement(MARIA.id, -60, '2026-11-18T09:00:00.000Z');
    await userEvent.click(screen.getByRole('button', { name: 'Riscatta 100 punti' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saldo insufficiente: il saldo è cambiato, controlla e riprova.',
    );
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Maria Rossi/ })).toHaveTextContent('60 pt'),
    );
    const cornetto = screen.getByRole('radio', { name: /Cornetto e cappuccino/ });
    expect(cornetto).toBeDisabled();
    expect(cornetto).not.toBeChecked();
    expect(cornetto).toHaveAccessibleName(/Mancano 40 punti/);
    expect(redeemButton()).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: /Caffè/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Riscatta 50 punti' }));
    await screen.findByRole('heading', { level: 1, name: 'Premio riscattato' });
    const ids = sentIds(ledger);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('10 punti');
  });
});

describe('RedeemPage: common states', () => {
  it.each([
    ['a customer that does not exist', `/clienti/${MISSING_ID}/premi`],
    ['an id that is not a uuid', '/clienti/abc/premi'],
  ])('%s: "Cliente non trovato" with a link to the home', async (_, path) => {
    renderRedeem({ path });
    expect(await screen.findByText('Cliente non trovato')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Riscatta premio' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna all’inizio' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('group', { name: 'CATALOGO' })).not.toBeInTheDocument();
  });

  it('a customer load error: the message and "Riprova"', async () => {
    const customers = createFakeCustomerService({ customers: [MARIA] });
    customers.failNext('get', 'network');
    renderRedeem({ customers });
    expect(await screen.findByText('Cliente non caricato')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await ready();
  });

  it('an erased customer: no rewards, a link to the page', async () => {
    renderRedeem({ path: `/clienti/${ERASED.id}/premi` });
    expect(
      await screen.findByText('Cliente cancellato: non si registrano spese né premi.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna alla scheda' })).toHaveAttribute(
      'href',
      `/clienti/${ERASED.id}`,
    );
    expect(screen.queryByRole('group', { name: 'CATALOGO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Premio libero/ })).not.toBeInTheDocument();
    expect(screen.queryByText('cancellato-7f3a')).not.toBeInTheDocument();
  });

  it('customer-unavailable on "Riscatta" (erased meanwhile): "Cliente non trovato"', async () => {
    const { ledger } = renderRedeem();
    await ready();
    await userEvent.click(screen.getByRole('radio', { name: /Caffè/ }));
    ledger.failNext('redeemReward', 'customer-unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Riscatta 50 punti' }));
    expect(await screen.findByText('Cliente non trovato')).toBeInTheDocument();
    expect(ledger.movements()).toHaveLength(0);
  });

  it('forbidden on "Riscatta": back to /accedi', async () => {
    const auth = signedInFake();
    const { router, ledger } = renderRedeem({ auth });
    await ready();
    await userEvent.click(screen.getByRole('radio', { name: /Caffè/ }));
    ledger.failNext('redeemReward', 'forbidden');
    auth.removeProfile();
    await userEvent.click(screen.getByRole('button', { name: 'Riscatta 50 punti' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(ledger.movements()).toHaveLength(0);
  });

  it('while a redemption is sent the button is busy and the choice is locked', async () => {
    const { ledger } = renderRedeem();
    await ready();
    await userEvent.click(screen.getByRole('radio', { name: /Caffè/ }));
    const held = ledger.holdNext('redeemReward');
    await userEvent.click(screen.getByRole('button', { name: 'Riscatta 50 punti' }));
    expect(screen.getByRole('radio', { name: /Cornetto/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Riscatta 50 punti' }));
    await act(async () => {
      held.release();
    });
    await screen.findByRole('heading', { level: 1, name: 'Premio riscattato' });
    expect(ledger.service.redeemReward).toHaveBeenCalledTimes(1);
  });
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Chooses "Cornetto e cappuccino" and redeems it with fake timers at 10:45 in Rome. */
async function redeemCornetto() {
  await ready();
  await userEvent.click(screen.getByRole('radio', { name: /Cornetto e cappuccino/ }));
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T09:45:00.000Z'));
  fireEvent.click(screen.getByRole('button', { name: 'Riscatta 100 punti' }));
  await advance(0);
}

describe('RedeemPage: Premio riscattato', () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('the texts of the wireframe Premio-ok, the vibration, back to / after 10 s', async () => {
    const vibrate = vi.fn<(pattern: VibratePattern) => boolean>(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const { router, ledger } = renderRedeem();
    await redeemCornetto();

    expect(screen.getByRole('heading', { level: 1, name: 'Premio riscattato' })).toHaveFocus();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByText('Cornetto e cappuccino per Maria Rossi · −100 punti')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('20 punti');
    expect(screen.getByText('Oggi 10:45 · Giulia Prova')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla il riscatto · 10 s' })).toBeEnabled();
    expect(vibrate).toHaveBeenCalledWith(200);
    expect(screen.getByRole('timer')).toHaveTextContent(
      'Torno alla lettura delle card tra 10 secondi',
    );
    expect(screen.getByRole('link', { name: 'Leggi un’altra card' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Apri la scheda di Maria' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}`,
    );

    await advance(2000);
    expect(screen.getByRole('button', { name: 'Annulla il riscatto · 8 s' })).toBeInTheDocument();
    await advance(7000);
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/premi`);
    await advance(1000);
    expect(router.state.location.pathname).toBe('/');
    expect(ledger.movements()).toHaveLength(1);
  });

  it('"Annulla il riscatto": "Riscatto annullato", the points back from the server, no return', async () => {
    const { router, ledger } = renderRedeem();
    // A waiter cancelling their own redemption within the window.
    ledger.setOperator({ ...fakeOperator, role: 'operator' });
    await redeemCornetto();
    await advance(3000);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla il riscatto · 7 s' }));
    await advance(0);

    expect(screen.getByRole('heading', { level: 1, name: 'Riscatto annullato' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('120 punti');
    const [redemption, correction] = ledger.movements();
    expect(ledger.movements()).toHaveLength(2);
    expect(correction).toMatchObject({
      kind: 'correction',
      points: 100,
      correctsMovementId: redemption?.id,
    });
    expect(correction?.operationId).not.toBe(redemption?.operationId);
    expect(screen.queryByRole('button', { name: /^Annulla il riscatto/ })).not.toBeInTheDocument();

    await advance(30_000);
    expect(router.state.location.pathname).toBe(`/clienti/${MARIA.id}/premi`);
  });

  it('the cancellation without an answer: "Riprova" resends the same id, a single correction', async () => {
    const { ledger } = renderRedeem();
    await redeemCornetto();
    ledger.failNext('cancelMovement', 'lost');
    fireEvent.click(screen.getByRole('button', { name: 'Annulla il riscatto · 10 s' }));
    await advance(0);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Annullamento non riuscito: controlla la connessione e riprova.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await advance(0);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Riscatto annullato' }),
    ).toBeInTheDocument();
    const cancels = ledger.calls.filter((call) => call.method === 'cancelMovement');
    expect(cancels).toHaveLength(2);
    expect(cancels[1]?.args).toEqual(cancels[0]?.args);
    expect(ledger.movements().filter((m) => m.kind === 'correction')).toHaveLength(1);
  });
});

const REDEEM_OFFLINE_TEXT =
  'Il telefono non è connesso a internet. Riprova appena torna la rete: il riscatto non verrà registrato due volte.';

describe('RedeemPage: Riscatto non salvato', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('network down: the alert, "Annulla" to / and "Riprova 100 punti" with the same id (criterion 4)', async () => {
    const { ledger } = renderRedeem();
    ledger.setNetworkDown(true);
    await redeemCornetto();

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Riscatto non salvato',
    );
    expect(alert).toHaveTextContent(REDEEM_OFFLINE_TEXT);
    expect(screen.getByRole('link', { name: 'Annulla' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('radio', { name: /Cornetto e cappuccino/ })).toBeDisabled();
    expect(ledger.movements()).toHaveLength(0);
    // Nothing is resent on its own.
    await advance(60_000);
    expect(sentIds(ledger)).toHaveLength(1);

    ledger.setNetworkDown(false);
    fireEvent.click(screen.getByRole('button', { name: 'Riprova 100 punti' }));
    await advance(0);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Premio riscattato' }),
    ).toBeInTheDocument();
    const ids = sentIds(ledger);
    expect(ids).toEqual([ids[0], ids[0]]);
    expect(ledger.movements()).toHaveLength(1);
  });

  it('answer lost after the write: "Riprova" gives the first result, a single redemption (criterion 4)', async () => {
    const { ledger } = renderRedeem();
    ledger.failNext('redeemReward', 'lost');
    await redeemCornetto();
    expect(screen.getByRole('alert')).toHaveTextContent(REDEEM_OFFLINE_TEXT);
    expect(ledger.movements()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Riprova 100 punti' }));
    await advance(0);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Premio riscattato' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('20 punti');
    const ids = sentIds(ledger);
    expect(ids).toEqual([ids[0], ids[0]]);
    expect(ledger.movements()).toHaveLength(1);
  });

  it('no answer within 8 s, or a fault of the server: the alert and "Riprova"', async () => {
    const { ledger } = renderRedeem();
    ledger.failNext('redeemReward', 'timeout');
    await redeemCornetto();
    await advance(8000);
    expect(screen.getByRole('alert')).toHaveTextContent(REDEEM_OFFLINE_TEXT);

    ledger.failNext('redeemReward', new ServerFaultError('unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Riprova 100 punti' }));
    await advance(0);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Il server non ha risposto correttamente. Riprova: il riscatto non verrà registrato due volte.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Riprova 100 punti' }));
    await advance(0);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Premio riscattato' }),
    ).toBeInTheDocument();
    const ids = sentIds(ledger);
    expect(ids).toEqual([ids[0], ids[0], ids[0]]);
    expect(ledger.movements()).toHaveLength(1);
  });
});
