import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeRewardsService, fakeReward } from '../../test/fakeRewardsService';
import { createFakeCustomerService } from '../../test/fakeCustomerService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { sortRewards } from './sortRewards';

const OPERATOR = { id: 'op-2', name: 'Marco Prova', role: 'operator' } as const;

describe('Catalogo premi page', () => {
  it('shows the catalogue title and a back link to the settings to administrators', async () => {
    const { router } = renderApp('/impostazioni/premi', signedInFake());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Catalogo premi' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Solo per gli amministratori')).not.toBeInTheDocument();
    const back = screen.getByRole('link', { name: 'Indietro' });
    expect(back).toHaveAttribute('href', '/impostazioni');
    await userEvent.click(back);
    expect(router.state.location.pathname).toBe('/impostazioni');
  });

  it('tells an operator who opens the URL that the catalogue is for administrators, without calling the service', async () => {
    const rewards = createFakeRewardsService();
    const { router } = renderApp(
      '/impostazioni/premi',
      signedInFake({ operator: OPERATOR }),
      createFakeSettingsService(),
      createFakeCustomerService(),
      rewards,
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Solo per gli amministratori' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Il catalogo premi lo gestiscono gli amministratori.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Catalogo premi' })).toBeInTheDocument();
    // No "Nuovo premio" box for an operator.
    expect(screen.queryByText(/Nuovo premio/)).not.toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Torna alle impostazioni' });
    expect(link).toHaveAttribute('href', '/impostazioni');
    expect(link).toHaveAttribute('data-variant', 'secondary');
    expect(rewards.calls).toEqual([]);

    await userEvent.click(link);
    expect(router.state.location.pathname).toBe('/impostazioni');
    expect(rewards.calls).toEqual([]);
  });
});

const WIREFRAME = [
  fakeReward({ name: 'Aperitivo', points: 200 }),
  fakeReward({ name: 'Dolce del giorno', points: 120, active: false }),
  fakeReward({ name: 'Caffè', points: 50 }),
  fakeReward({ name: 'Colazione per due', points: 180 }),
  fakeReward({ name: 'Cornetto e cappuccino', points: 100 }),
];

function renderCatalog(rewards = createFakeRewardsService({ rewards: WIREFRAME })) {
  const rendered = renderApp(
    '/impostazioni/premi',
    signedInFake(),
    createFakeSettingsService(),
    createFakeCustomerService(),
    rewards,
  );
  return { ...rendered, rewards };
}

/** The rows of the catalogue, as the names they show, in order. */
function rowNames(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-reward-name]')?.textContent ?? '');
}

describe('Catalogo premi list', () => {
  it('shows the loading state while the catalogue loads, then the rewards', async () => {
    const rewards = createFakeRewardsService({ rewards: WIREFRAME });
    const held = rewards.holdNext('listAll');
    renderCatalog(rewards);
    // The session check shows its own "Caricamento…" first: wait for the catalogue's screen.
    await screen.findByRole('heading', { level: 1, name: 'Catalogo premi' });
    expect(screen.getByText('Caricamento…')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Premi del catalogo' })).not.toBeInTheDocument();
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    expect(await screen.findByRole('list', { name: 'Premi del catalogo' })).toBeInTheDocument();
    expect(screen.queryByText('Caricamento…')).not.toBeInTheDocument();
    expect(rewards.calls.map((call) => call.method)).toEqual(['listAll']);
  });

  it('lists the rewards in sortRewards() order, the inactive one last', async () => {
    const rewards = createFakeRewardsService({ rewards: WIREFRAME });
    // An answer out of order: the page sorts it itself.
    rewards.service.listAll.mockResolvedValueOnce([...WIREFRAME]);
    renderCatalog(rewards);
    const list = await screen.findByRole('list', { name: 'Premi del catalogo' });
    expect(rowNames(list)).toEqual(sortRewards(WIREFRAME).map((reward) => reward.name));
    expect(rowNames(list)).toEqual([
      'Caffè',
      'Cornetto e cappuccino',
      'Colazione per due',
      'Aperitivo',
      'Dolce del giorno',
    ]);
  });

  it('shows name, points and the Attivo box of each row; the inactive row is grey with its note', async () => {
    renderCatalog();
    const list = await screen.findByRole('list', { name: 'Premi del catalogo' });
    const [coffee] = within(list).getAllByRole('listitem');
    expect(coffee).toHaveTextContent('Caffè');
    expect(within(coffee!).getByText('50 punti')).toBeInTheDocument();
    expect(within(coffee!).getByRole('checkbox', { name: 'Caffè attivo' })).toBeChecked();
    expect(coffee).not.toHaveAttribute('data-inactive');

    const dessert = within(list).getAllByRole('listitem').at(-1);
    expect(dessert).toHaveAttribute('data-inactive', 'true');
    expect(
      within(dessert!).getByText('120 punti · non visibile alla cassa né al cliente'),
    ).toBeInTheDocument();
    expect(
      within(dessert!).getByRole('checkbox', { name: 'Dolce del giorno attivo' }),
    ).not.toBeChecked();
  });

  it('gives every Attivo box a distinct accessible name', async () => {
    renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    const names = screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'));
    expect(names).toEqual([
      'Caffè attivo',
      'Cornetto e cappuccino attivo',
      'Colazione per due attivo',
      'Aperitivo attivo',
      'Dolce del giorno attivo',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('an empty catalogue says so and invites to add the first reward', async () => {
    renderCatalog(createFakeRewardsService());
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Nessun premio nel catalogo' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Aggiungi il primo premio qui sotto.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Premi del catalogo' })).not.toBeInTheDocument();
  });

  it('a load error: says so, and "Riprova" loads again with the focus on the title', async () => {
    const rewards = createFakeRewardsService({ rewards: WIREFRAME });
    rewards.failNext('listAll', 'network');
    renderCatalog(rewards);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Catalogo non caricato');
    expect(alert).toHaveTextContent('Controlla la connessione e riprova.');

    const held = rewards.holdNext('listAll');
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(screen.getByText('Caricamento…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Catalogo premi' })).toHaveFocus();
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    const list = await screen.findByRole('list', { name: 'Premi del catalogo' });
    expect(rowNames(list)).toHaveLength(5);
    expect(rewards.calls.map((call) => call.method)).toEqual(['listAll', 'listAll']);
  });

  it.each([
    ['misconfigured', 'Servizio non configurato: chiedi a un amministratore.'],
    ['unavailable', 'Servizio momentaneamente non disponibile: riprova tra poco.'],
  ] as const)('a %s server fault is worded apart from the connection', async (kind, text) => {
    const rewards = createFakeRewardsService({ rewards: WIREFRAME });
    rewards.failNext('listAll', new ServerFaultError(kind));
    renderCatalog(rewards);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Catalogo non caricato');
    expect(alert).toHaveTextContent(text);
  });
});
