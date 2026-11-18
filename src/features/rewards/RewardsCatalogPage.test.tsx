import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeRewardsService, fakeReward } from '../../test/fakeRewardsService';
import { fakeOperator } from '../../test/fakeAuthService';
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
    const list = await screen.findByRole('list', { name: 'Premi del catalogo' });
    // The rows' boxes; the "Nuovo premio" box below has its own "Attivo".
    const names = within(list)
      .getAllByRole('checkbox')
      .map((box) => box.getAttribute('aria-label'));
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

async function openList(rewards = createFakeRewardsService({ rewards: WIREFRAME })) {
  const rendered = renderCatalog(rewards);
  const list = await screen.findByRole('list', { name: 'Premi del catalogo' });
  return { ...rendered, list };
}

function rowOf(list: HTMLElement, name: string): HTMLElement {
  const row = within(list)
    .getAllByRole('listitem')
    .find((item) => item.querySelector('[data-reward-name]')?.textContent === name);
  if (!row) throw new Error(`no row ${name}`);
  return row;
}

describe('Catalogo premi: the Attivo box of a row', () => {
  it('deactivating saves at once: the row goes grey at the bottom with the focus on its box', async () => {
    const { list, rewards } = await openList();
    const coffee = WIREFRAME.find((reward) => reward.name === 'Caffè')!;
    await userEvent.click(screen.getByRole('checkbox', { name: 'Caffè attivo' }));

    await waitFor(() =>
      expect(rowNames(list)).toEqual([
        'Cornetto e cappuccino',
        'Colazione per due',
        'Aperitivo',
        'Caffè',
        'Dolce del giorno',
      ]),
    );
    const row = rowOf(list, 'Caffè');
    expect(row).toHaveAttribute('data-inactive', 'true');
    expect(
      within(row).getByText('50 punti · non visibile alla cassa né al cliente'),
    ).toBeInTheDocument();
    const box = within(row).getByRole('checkbox', { name: 'Caffè attivo' });
    expect(box).not.toBeChecked();
    expect(box).toBeEnabled();
    expect(box).toHaveFocus();
    expect(rewards.calls.filter((call) => call.method === 'setActive')).toEqual([
      { method: 'setActive', args: [coffee.id, false] },
    ]);
    expect(rewards.rewards().find((reward) => reward.id === coffee.id)?.active).toBe(false);
    // The list is loaded again from the server after the write.
    await waitFor(() =>
      expect(rewards.calls.filter((call) => call.method === 'listAll')).toHaveLength(2),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reactivating brings the row back among the active ones, the focus still on its box', async () => {
    const { list } = await openList();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Dolce del giorno attivo' }));

    await waitFor(() =>
      expect(rowNames(list)).toEqual([
        'Caffè',
        'Cornetto e cappuccino',
        'Dolce del giorno',
        'Colazione per due',
        'Aperitivo',
      ]),
    );
    const row = rowOf(list, 'Dolce del giorno');
    expect(row).not.toHaveAttribute('data-inactive');
    expect(within(row).getByText('120 punti')).toBeInTheDocument();
    const box = within(row).getByRole('checkbox', { name: 'Dolce del giorno attivo' });
    expect(box).toBeChecked();
    expect(box).toHaveFocus();
  });

  it('the box is disabled while the call is on its way, showing the new state', async () => {
    const { list, rewards } = await openList();
    const held = rewards.holdNext('setActive');
    const box = screen.getByRole('checkbox', { name: 'Caffè attivo' });
    await userEvent.click(box);

    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    // A second tap while disabled sends nothing.
    await userEvent.click(box);
    expect(rewards.calls.filter((call) => call.method === 'setActive')).toHaveLength(1);
    // The row does not move before the answer.
    expect(rowNames(list)[0]).toBe('Caffè');

    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    const saved = await within(rowOf(list, 'Caffè')).findByRole('checkbox', {
      name: 'Caffè attivo',
    });
    await waitFor(() => expect(saved).toBeEnabled());
    expect(saved).not.toBeChecked();
  });

  it('a network error restores the box and says so under the row; a new tap resends', async () => {
    const { list, rewards } = await openList();
    rewards.failNext('setActive', 'network');
    const box = screen.getByRole('checkbox', { name: 'Caffè attivo' });
    await userEvent.click(box);

    const row = rowOf(list, 'Caffè');
    const alert = await within(row).findByRole('alert');
    expect(alert).toHaveTextContent('Premio non salvato: controlla la connessione e riprova.');
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
    expect(box).toHaveFocus();
    expect(box).toHaveAccessibleDescription(
      'Premio non salvato: controlla la connessione e riprova.',
    );
    expect(rowNames(list)[0]).toBe('Caffè');
    expect(row).not.toHaveAttribute('data-inactive');
    // No reload after a network error: nothing changed.
    expect(rewards.calls.filter((call) => call.method === 'listAll')).toHaveLength(1);

    // Setting a value is safe to resend: the next tap saves and clears the message.
    await userEvent.click(box);
    await waitFor(() => expect(rowNames(list).at(-2)).toBe('Caffè'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['not-found', 'unknown'] as const)(
    '%s: restores the box, says "Premio non salvato: riprova." and reloads the list',
    async (error) => {
      const { list, rewards } = await openList();
      rewards.failNext('setActive', error);
      const box = screen.getByRole('checkbox', { name: 'Caffè attivo' });
      await userEvent.click(box);

      const alert = await within(rowOf(list, 'Caffè')).findByRole('alert');
      expect(alert).toHaveTextContent('Premio non salvato: riprova.');
      expect(box).toBeChecked();
      await waitFor(() =>
        expect(rewards.calls.filter((call) => call.method === 'listAll')).toHaveLength(2),
      );
    },
  );

  it.each([
    ['misconfigured', 'Servizio non configurato: chiedi a un amministratore.'],
    ['unavailable', 'Servizio momentaneamente non disponibile: riprova tra poco.'],
  ] as const)('a %s server fault restores the box with its own words', async (kind, text) => {
    const { list, rewards } = await openList();
    rewards.failNext('setActive', new ServerFaultError(kind));
    const box = screen.getByRole('checkbox', { name: 'Caffè attivo' });
    await userEvent.click(box);

    const alert = await within(rowOf(list, 'Caffè')).findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
  });

  it('forbidden: says "Solo per gli amministratori" and reports it to AuthProvider', async () => {
    const auth = signedInFake();
    const rewards = createFakeRewardsService({ rewards: WIREFRAME });
    renderApp(
      '/impostazioni/premi',
      auth,
      createFakeSettingsService(),
      createFakeCustomerService(),
      rewards,
    );
    const list = await screen.findByRole('list', { name: 'Premi del catalogo' });
    const checksBefore = auth.service.loadOperator.mock.calls.length;
    rewards.failNext('setActive', 'forbidden');
    const box = screen.getByRole('checkbox', { name: 'Caffè attivo' });
    await userEvent.click(box);

    const alert = await within(rowOf(list, 'Caffè')).findByRole('alert');
    expect(alert).toHaveTextContent('Solo per gli amministratori');
    expect(box).toBeChecked();
    await waitFor(() => expect(auth.service.loadOperator.mock.calls.length).toBe(checksBefore + 1));
  });

  it('forbidden after the role became operator: the page shows the permission message', async () => {
    const auth = signedInFake();
    const rewards = createFakeRewardsService({ rewards: WIREFRAME });
    renderApp(
      '/impostazioni/premi',
      auth,
      createFakeSettingsService(),
      createFakeCustomerService(),
      rewards,
    );
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    auth.setProfile({ ...fakeOperator, role: 'operator' });
    rewards.failNext('setActive', 'forbidden');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Caffè attivo' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Solo per gli amministratori' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Premi del catalogo' })).not.toBeInTheDocument();
  });
});
