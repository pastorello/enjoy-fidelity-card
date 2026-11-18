import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeRewardsService, fakeReward } from '../../test/fakeRewardsService';
import { createFakeCustomerService } from '../../test/fakeCustomerService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const WIREFRAME = [
  fakeReward({ name: 'Caffè', points: 50 }),
  fakeReward({ name: 'Cornetto e cappuccino', points: 100 }),
  fakeReward({ name: 'Colazione per due', points: 180 }),
  fakeReward({ name: 'Aperitivo', points: 200 }),
  fakeReward({ name: 'Dolce del giorno', points: 120, active: false }),
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function renderCatalog(rewards = createFakeRewardsService({ rewards: WIREFRAME })) {
  renderApp(
    '/impostazioni/premi',
    signedInFake(),
    createFakeSettingsService(),
    createFakeCustomerService(),
    rewards,
  );
  return rewards;
}

/** The "Nuovo premio" box and its controls. */
function box() {
  const region = screen.getByRole('region', { name: 'Nuovo premio' });
  return {
    region,
    name: within(region).getByRole('textbox', { name: 'Nome del premio' }),
    points: within(region).getByRole('textbox', { name: 'Punti richiesti' }),
    active: within(region).getByRole('checkbox', { name: 'Attivo' }),
    // Looked up when used: after a lost answer the same button says "Riprova".
    get add() {
      return within(region).getByRole('button', { name: 'Aggiungi premio' });
    },
  };
}

/** The rows of the catalogue, as the names they show, in order. */
function rowNames(): string[] {
  const list = screen.getByRole('list', { name: 'Premi del catalogo' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-reward-name]')?.textContent ?? '');
}

async function fill(name: string, points: string) {
  const { name: nameField, points: pointsField } = box();
  await userEvent.clear(nameField);
  if (name) await userEvent.type(nameField, name);
  await userEvent.clear(pointsField);
  if (points) await userEvent.type(pointsField, points);
}

function listCalls(rewards: ReturnType<typeof createFakeRewardsService>) {
  return rewards.calls.filter((call) => call.method === 'listAll');
}

function createCalls(rewards: ReturnType<typeof createFakeRewardsService>) {
  return rewards.calls.filter((call) => call.method === 'create');
}

describe('Nuovo premio box', () => {
  it('shows the fields of the wireframe, Attivo ticked, in a box fixed at the bottom', async () => {
    renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    const { region, name, points, active, add } = box();
    expect(within(region).getByRole('heading', { level: 2, name: 'Nuovo premio' })).toBeVisible();
    expect(name).toHaveAttribute('placeholder', 'Es. Spremuta');
    expect(name).toHaveValue('');
    expect(points).toHaveAttribute('placeholder', 'Es. 80');
    expect(points).toHaveAttribute('inputmode', 'numeric');
    expect(points).toHaveValue('');
    expect(active).toBeChecked();
    expect(add).toHaveAttribute('data-variant', 'primary');
    expect(add).toBeEnabled();
    // Fixed at the bottom: the box is the footer of the screen, on the raised surface.
    const footer = screen.getByRole('contentinfo');
    expect(footer).toContainElement(region);
    expect(footer).toHaveAttribute('data-tone', 'raised');
  });

  it('is disabled while the catalogue loads, enabled once it is shown', async () => {
    const rewards = createFakeRewardsService({ rewards: WIREFRAME });
    const held = rewards.holdNext('listAll');
    renderCatalog(rewards);
    await screen.findByRole('heading', { level: 1, name: 'Catalogo premi' });
    const loading = box();
    expect(loading.name).toBeDisabled();
    expect(loading.points).toBeDisabled();
    expect(loading.active).toBeDisabled();
    expect(loading.add).toBeDisabled();
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    const shown = box();
    expect(shown.name).toBeEnabled();
    expect(shown.points).toBeEnabled();
    expect(shown.active).toBeEnabled();
    expect(shown.add).toBeEnabled();
  });

  it('is enabled on an empty catalogue', async () => {
    renderCatalog(createFakeRewardsService());
    await screen.findByRole('heading', { level: 2, name: 'Nessun premio nel catalogo' });
    expect(box().name).toBeEnabled();
    expect(box().add).toBeEnabled();
  });

  it('adds "Spremuta" 80: the row lands between Caffè and Cornetto e cappuccino, the fields empty, "Premio aggiunto" announced', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    const status = within(box().region).getByRole('status');
    expect(status).toHaveTextContent('');

    await fill(' Spremuta ', '80');
    await userEvent.click(box().add);

    await waitFor(() =>
      expect(rowNames()).toEqual([
        'Caffè',
        'Spremuta',
        'Cornetto e cappuccino',
        'Colazione per due',
        'Aperitivo',
        'Dolce del giorno',
      ]),
    );
    const [call] = createCalls(rewards);
    expect(call?.args).toEqual([
      { id: expect.stringMatching(UUID), name: 'Spremuta', points: 80, active: true },
    ]);
    expect(box().name).toHaveValue('');
    expect(box().points).toHaveValue('');
    expect(box().active).toBeChecked();
    expect(status).toHaveTextContent('Premio aggiunto');
    // The list is asked again after the write: other administrators may have changed it.
    await waitFor(() =>
      expect(rewards.calls.filter((c) => c.method === 'listAll')).toHaveLength(2),
    );
  });

  it('adds an inactive reward when Attivo is unticked: grey among the inactive ones, with its note', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await fill('Spremuta', '80');
    await userEvent.click(box().active);
    await userEvent.click(box().add);

    // Inactive ones by points too: 80 comes before Dolce del giorno's 120.
    await waitFor(() => expect(rowNames().slice(-2)).toEqual(['Spremuta', 'Dolce del giorno']));
    expect(createCalls(rewards)[0]?.args[0]).toMatchObject({ active: false });
    expect(
      screen.getByText('80 punti · non visibile alla cassa né al cliente'),
    ).toBeInTheDocument();
    // Back to the default for the next reward.
    expect(box().active).toBeChecked();
  });

  it('pressing Enter in a field adds the reward too', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await fill('Spremuta', '80{Enter}');
    await waitFor(() => expect(rowNames()).toContain('Spremuta'));
    expect(createCalls(rewards)).toHaveLength(1);
  });
});

describe('Nuovo premio box: validation', () => {
  it('an empty form: both messages under their fields, the focus on the name, no call', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await userEvent.click(box().add);

    const { name, points } = box();
    expect(name).toHaveAccessibleDescription('Scrivi il nome del premio');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(points).toHaveAccessibleDescription('Scrivi i punti: un numero intero maggiore di zero');
    expect(points).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();
    expect(createCalls(rewards)).toEqual([]);
    expect(within(box().region).getByRole('status')).toHaveTextContent('');
  });

  it.each([
    ['1,5', 'Scrivi i punti: un numero intero maggiore di zero'],
    ['0', 'Scrivi i punti: un numero intero maggiore di zero'],
    ['-3', 'Scrivi i punti: un numero intero maggiore di zero'],
    ['100000', 'Al massimo 99.999 punti'],
  ])('points "%s": "%s" under the points, the focus there, no call', async (typed, message) => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await fill('Spremuta', typed);
    await userEvent.click(box().add);

    expect(box().points).toHaveAccessibleDescription(message);
    expect(box().points).toHaveFocus();
    expect(box().name).not.toHaveAttribute('aria-invalid');
    expect(createCalls(rewards)).toEqual([]);
    // Nothing is lost: the fields keep what was typed.
    expect(box().name).toHaveValue('Spremuta');
    expect(box().points).toHaveValue(typed);
  });

  it('a name of 61 characters: "Il nome è troppo lungo" under the name, the focus there, no call', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await fill('a'.repeat(61), '80');
    await userEvent.click(box().add);

    expect(box().name).toHaveAccessibleDescription('Il nome è troppo lungo (massimo 60 caratteri)');
    expect(box().name).toHaveFocus();
    expect(createCalls(rewards)).toEqual([]);
  });

  it('a corrected form is added and the messages go away', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await fill('', '80');
    await userEvent.click(box().add);
    expect(box().name).toHaveFocus();

    await fill('Spremuta', '80');
    await userEvent.click(box().add);
    await waitFor(() => expect(rowNames()).toContain('Spremuta'));
    expect(createCalls(rewards)).toHaveLength(1);
    expect(box().name).not.toHaveAttribute('aria-invalid');
    expect(box().points).not.toHaveAttribute('aria-invalid');
  });
});

describe('Nuovo premio box: the id of the new reward', () => {
  it('after a successful save the next reward is sent with a new id', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });

    await fill('Spremuta', '80');
    await userEvent.click(box().add);
    await waitFor(() => expect(rowNames()).toContain('Spremuta'));

    await fill('Centrifugato', '90');
    await userEvent.click(box().add);
    await waitFor(() => expect(rowNames()).toContain('Centrifugato'));

    const ids = rewards.service.create.mock.calls.map(([input]) => input.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(UUID);
    expect(ids[1]).toMatch(UUID);
    expect(ids[1]).not.toBe(ids[0]);
    expect(rewards.rewards().filter((r) => r.name === 'Spremuta')).toHaveLength(1);
    expect(rewards.rewards().filter((r) => r.name === 'Centrifugato')).toHaveLength(1);
  });
});

describe('Nuovo premio box: write errors', () => {
  const NETWORK = 'Premio non salvato: controlla la connessione e riprova.';

  it('"Aggiungi premio" is busy until the answer: a double tap sends one call', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await fill('Spremuta', '80');
    const held = rewards.holdNext('create');
    const { add } = box();
    await userEvent.dblClick(add);

    expect(add).toHaveAttribute('aria-busy', 'true');
    expect(add).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(add);
    expect(createCalls(rewards)).toHaveLength(1);

    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    await waitFor(() => expect(rowNames()).toContain('Spremuta'));
    expect(box().add).not.toHaveAttribute('aria-busy');
    expect(createCalls(rewards)).toHaveLength(1);
    expect(rewards.rewards().filter((r) => r.name === 'Spremuta')).toHaveLength(1);
  });

  it('a network error keeps the fields and offers "Riprova", which resends with the same id: one row', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await fill('Spremuta', '80');
    await userEvent.click(box().active);
    rewards.failNext('create', 'network');
    await userEvent.click(box().add);

    const alert = await within(box().region).findByRole('alert');
    expect(alert).toHaveTextContent(NETWORK);
    expect(box().name).toHaveValue('Spremuta');
    expect(box().points).toHaveValue('80');
    expect(box().active).not.toBeChecked();
    expect(within(box().region).getByRole('status')).toHaveTextContent('');
    // Nothing changed on a lost connection: the list is not asked again.
    expect(listCalls(rewards)).toHaveLength(1);
    const retry = within(box().region).getByRole('button', { name: 'Riprova' });
    expect(retry).toHaveFocus();

    await userEvent.click(retry);
    await waitFor(() => expect(rowNames()).toContain('Spremuta'));
    const ids = rewards.service.create.mock.calls.map(([input]) => input.id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(rewards.rewards().filter((r) => r.name === 'Spremuta')).toHaveLength(1);
    expect(within(box().region).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(box().region).getByRole('status')).toHaveTextContent('Premio aggiunto');
    expect(box().add).toBeInTheDocument();
  });

  it('a new tap after a network error resends with the same id too (Enter in a field)', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    rewards.failNext('create', 'network');
    await fill('Spremuta', '80{Enter}');
    await within(box().region).findByRole('alert');

    await userEvent.type(box().points, '{Enter}');
    await waitFor(() => expect(rowNames()).toContain('Spremuta'));
    const ids = rewards.service.create.mock.calls.map(([input]) => input.id);
    expect(ids).toEqual([ids[0], ids[0]]);
    expect(rewards.rewards().filter((r) => r.name === 'Spremuta')).toHaveLength(1);
  });

  it('an answer lost after the save, then the form changed and "Riprova": the row of the server is listed', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await fill('Spremuta', '80');
    rewards.failNext('create', 'lost');
    await userEvent.click(box().add);
    await within(box().region).findByRole('alert');

    await fill('Centrifugato', '90');
    await userEvent.click(within(box().region).getByRole('button', { name: 'Riprova' }));

    await waitFor(() => expect(rowNames()).toContain('Spremuta'));
    expect(rowNames()).not.toContain('Centrifugato');
    expect(screen.getByText('80 punti')).toBeInTheDocument();
    const ids = rewards.service.create.mock.calls.map(([input]) => input.id);
    expect(ids).toEqual([ids[0], ids[0]]);
    expect(rewards.rewards().filter((r) => r.name === 'Spremuta')).toHaveLength(1);
    expect(rewards.rewards().filter((r) => r.name === 'Centrifugato')).toHaveLength(0);
    // A success: the fields empty for the next reward.
    expect(box().name).toHaveValue('');
    expect(box().points).toHaveValue('');
  });

  it('a name already used with other capitals: the message under the name, the focus there, the fields kept', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await fill('CAFFÈ', '80');
    await userEvent.click(box().add);

    await waitFor(() =>
      expect(box().name).toHaveAccessibleDescription('Esiste già un premio con questo nome'),
    );
    expect(box().name).toHaveAttribute('aria-invalid', 'true');
    expect(box().name).toHaveFocus();
    expect(box().name).toHaveValue('CAFFÈ');
    expect(box().points).toHaveValue('80');
    expect(within(box().region).queryByRole('alert')).not.toBeInTheDocument();
    expect(rowNames().filter((name) => name.toLowerCase() === 'caffè')).toHaveLength(1);
    expect(createCalls(rewards)).toHaveLength(1);
    expect(rewards.rewards().filter((r) => r.name.toLowerCase() === 'caffè')).toHaveLength(1);

    // Corrected, it is added.
    await fill('Caffè doppio', '80');
    await userEvent.click(box().add);
    await waitFor(() => expect(rowNames()).toContain('Caffè doppio'));
    expect(box().name).not.toHaveAttribute('aria-invalid');
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
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    const checksBefore = auth.service.loadOperator.mock.calls.length;
    rewards.failNext('create', 'forbidden');
    await fill('Spremuta', '80');
    await userEvent.click(box().add);

    const alert = await within(box().region).findByRole('alert');
    expect(alert).toHaveTextContent('Solo per gli amministratori');
    await waitFor(() => expect(auth.service.loadOperator.mock.calls.length).toBe(checksBefore + 1));
    expect(rowNames()).not.toContain('Spremuta');
  });

  it.each(['not-found', 'unknown'] as const)(
    '%s: says "Premio non salvato: riprova.", keeps the fields and reloads the list',
    async (error) => {
      const rewards = renderCatalog();
      await screen.findByRole('list', { name: 'Premi del catalogo' });
      rewards.failNext('create', error);
      await fill('Spremuta', '80');
      await userEvent.click(box().add);

      const alert = await within(box().region).findByRole('alert');
      expect(alert).toHaveTextContent('Premio non salvato: riprova.');
      expect(box().name).toHaveValue('Spremuta');
      expect(within(box().region).getByRole('button', { name: 'Aggiungi premio' })).toBeEnabled();
      await waitFor(() => expect(listCalls(rewards)).toHaveLength(2));
    },
  );

  it('invalid on values the app accepted: says "Premio non salvato: riprova." and keeps the fields', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    rewards.failNext('create', 'invalid');
    await fill('Spremuta', '80');
    await userEvent.click(box().add);

    const alert = await within(box().region).findByRole('alert');
    expect(alert).toHaveTextContent('Premio non salvato: riprova.');
    expect(box().name).toHaveValue('Spremuta');
    expect(box().points).toHaveValue('80');
  });

  it.each([
    ['misconfigured', 'Servizio non configurato: chiedi a un amministratore.'],
    ['unavailable', 'Servizio momentaneamente non disponibile: riprova tra poco.'],
  ] as const)(
    'a %s server fault: its own words, the fields kept, "Riprova" with the same id',
    async (kind, text) => {
      const rewards = renderCatalog();
      await screen.findByRole('list', { name: 'Premi del catalogo' });
      rewards.failNext('create', new ServerFaultError(kind));
      await fill('Spremuta', '80');
      await userEvent.click(box().add);

      const alert = await within(box().region).findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(box().name).toHaveValue('Spremuta');
      await userEvent.click(within(box().region).getByRole('button', { name: 'Riprova' }));
      await waitFor(() => expect(rowNames()).toContain('Spremuta'));
      const ids = rewards.service.create.mock.calls.map(([input]) => input.id);
      expect(ids).toEqual([ids[0], ids[0]]);
    },
  );
});
