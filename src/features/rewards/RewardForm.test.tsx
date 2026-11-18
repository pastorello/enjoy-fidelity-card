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
    const checksBefore = auth.service.loadIdentity.mock.calls.length;
    rewards.failNext('create', 'forbidden');
    await fill('Spremuta', '80');
    await userEvent.click(box().add);

    const alert = await within(box().region).findByRole('alert');
    expect(alert).toHaveTextContent('Solo per gli amministratori');
    await waitFor(() => expect(auth.service.loadIdentity.mock.calls.length).toBe(checksBefore + 1));
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

/** The "Modifica premio" box and its controls. */
function editBox() {
  const region = screen.getByRole('region', { name: 'Modifica premio' });
  return {
    region,
    name: within(region).getByRole('textbox', { name: 'Nome del premio' }),
    points: within(region).getByRole('textbox', { name: 'Punti richiesti' }),
    get save() {
      return within(region).getByRole('button', { name: /^(Salva modifiche|Riprova)$/ });
    },
    cancel: within(region).getByRole('button', { name: 'Annulla' }),
  };
}

/** The button on the name and points of a row, by the text it shows. */
function editButton(text: string) {
  const list = screen.getByRole('list', { name: 'Premi del catalogo' });
  return within(list).getByRole('button', { name: `Modifica ${text}` });
}

async function fillEdit(name: string, points: string) {
  const { name: nameField, points: pointsField } = editBox();
  await userEvent.clear(nameField);
  if (name) await userEvent.type(nameField, name);
  await userEvent.clear(pointsField);
  if (points) await userEvent.type(pointsField, points);
}

function updateCalls(rewards: ReturnType<typeof createFakeRewardsService>) {
  return rewards.calls.filter((call) => call.method === 'update');
}

const HISTORY_NOTE =
  'Nome e punti valgono per i riscatti da ora in poi: i riscatti già registrati non cambiano.';

describe('Modifica premio box', () => {
  it('tapping name and points of a row opens "Modifica premio" filled in, without Attivo, the row highlighted', async () => {
    renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    const coffee = editButton('Caffè 50 punti');
    expect(coffee).not.toHaveAttribute('aria-current');
    await userEvent.click(coffee);

    const { region, name, points, save, cancel } = editBox();
    expect(
      within(region).getByRole('heading', { level: 2, name: 'Modifica premio' }),
    ).toBeVisible();
    expect(name).toHaveValue('Caffè');
    expect(name).toHaveFocus();
    expect(points).toHaveValue('50');
    expect(points).toHaveAttribute('inputmode', 'numeric');
    expect(within(region).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(save).toHaveAccessibleName('Salva modifiche');
    expect(save).toHaveAttribute('data-variant', 'primary');
    expect(cancel).toHaveAttribute('data-variant', 'secondary');
    expect(within(region).getByText(HISTORY_NOTE)).toBeVisible();
    // The box replaces "Nuovo premio" in the footer.
    expect(screen.getByRole('contentinfo')).toContainElement(region);
    expect(screen.queryByRole('region', { name: 'Nuovo premio' })).not.toBeInTheDocument();
    // The row being changed is highlighted.
    expect(editButton('Caffè 50 punti')).toHaveAttribute('aria-current', 'true');
    expect(editButton('Caffè 50 punti').closest('li')).toHaveAttribute('data-editing', 'true');
  });

  it('an inactive row opens too, its Attivo box staying in the row', async () => {
    renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await userEvent.click(
      editButton('Dolce del giorno 120 punti · non visibile alla cassa né al cliente'),
    );
    expect(editBox().name).toHaveValue('Dolce del giorno');
    expect(editBox().points).toHaveValue('120');
    expect(screen.getByRole('checkbox', { name: 'Dolce del giorno attivo' })).not.toBeChecked();
  });

  it('while a row is changed the other rows do not open a second change', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await userEvent.click(editButton('Caffè 50 punti'));
    const other = editButton('Aperitivo 200 punti');
    expect(other).toBeDisabled();
    await userEvent.click(other);
    expect(editBox().name).toHaveValue('Caffè');
    expect(other).not.toHaveAttribute('aria-current');
    // The Attivo boxes of the rows still save at once.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Aperitivo attivo' }));
    await waitFor(() =>
      expect(rewards.rewards().find((r) => r.name === 'Aperitivo')?.active).toBe(false),
    );
    expect(editBox().name).toHaveValue('Caffè');
  });

  it('"Salva modifiche" saves name and points: the row is updated and moved, the box back to "Nuovo premio"', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    const id = rewards.rewards().find((r) => r.name === 'Caffè')!.id;
    await userEvent.click(editButton('Caffè 50 punti'));
    await fillEdit('  Caffè lungo ', '150');
    await userEvent.click(editBox().save);

    await waitFor(() =>
      expect(rowNames()).toEqual([
        'Cornetto e cappuccino',
        'Caffè lungo',
        'Colazione per due',
        'Aperitivo',
        'Dolce del giorno',
      ]),
    );
    expect(rewards.service.update).toHaveBeenCalledExactlyOnceWith(id, {
      name: 'Caffè lungo',
      points: 150,
    });
    expect(screen.queryByRole('region', { name: 'Modifica premio' })).not.toBeInTheDocument();
    expect(box().name).toHaveValue('');
    // The focus goes back to the row, in its new place.
    expect(editButton('Caffè lungo 150 punti')).toHaveFocus();
    expect(editButton('Caffè lungo 150 punti')).not.toHaveAttribute('aria-current');
    expect(editButton('Aperitivo 200 punti')).toBeEnabled();
    expect(rewards.rewards().find((r) => r.id === id)).toMatchObject({
      name: 'Caffè lungo',
      points: 150,
      active: true,
    });
    // As after every write, the list is asked again.
    await waitFor(() => expect(listCalls(rewards)).toHaveLength(2));
  });

  it('"Annulla" saves nothing and gives back the "Nuovo premio" draft as it was, with the same id', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    // A draft not saved: the first try got no answer.
    await fill('Spremuta', '80');
    await userEvent.click(box().active);
    rewards.failNext('create', 'network');
    await userEvent.click(box().add);
    await within(box().region).findByRole('alert');

    await userEvent.click(editButton('Caffè 50 punti'));
    await fillEdit('Caffè lungo', '150');
    await userEvent.click(editBox().cancel);

    expect(screen.queryByRole('region', { name: 'Modifica premio' })).not.toBeInTheDocument();
    expect(updateCalls(rewards)).toHaveLength(0);
    expect(rowNames()).toContain('Caffè');
    expect(editButton('Caffè 50 punti')).toHaveFocus();
    const draft = box();
    expect(draft.name).toHaveValue('Spremuta');
    expect(draft.points).toHaveValue('80');
    expect(draft.active).not.toBeChecked();
    const retry = within(draft.region).getByRole('button', { name: 'Riprova' });
    await userEvent.click(retry);
    await waitFor(() => expect(rowNames()).toContain('Spremuta'));
    const ids = rewards.service.create.mock.calls.map(([input]) => input.id);
    expect(ids).toEqual([ids[0], ids[0]]);
    expect(ids[0]).toMatch(UUID);
  });

  it('after a successful change the "Nuovo premio" draft is still there', async () => {
    renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await fill('Spremuta', '80');
    await userEvent.click(editButton('Aperitivo 200 punti'));
    await fillEdit('Aperitivo', '210');
    await userEvent.click(editBox().save);
    await waitFor(() => expect(box().name).toHaveValue('Spremuta'));
    expect(box().points).toHaveValue('80');
    expect(screen.getByText('210 punti')).toBeInTheDocument();
  });

  it('checks the values first: messages under the fields, the focus on the first, no call', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await userEvent.click(editButton('Caffè 50 punti'));
    await fillEdit('', '0');
    await userEvent.click(editBox().save);

    expect(editBox().name).toHaveAccessibleDescription('Scrivi il nome del premio');
    expect(editBox().points).toHaveAccessibleDescription(
      'Scrivi i punti: un numero intero maggiore di zero',
    );
    expect(editBox().name).toHaveFocus();
    expect(updateCalls(rewards)).toHaveLength(0);
  });

  it('"Salva modifiche" is busy until the answer: a double tap sends one call', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await userEvent.click(editButton('Caffè 50 punti'));
    await fillEdit('Caffè lungo', '60');
    const held = rewards.holdNext('update');
    const { save } = editBox();
    await userEvent.dblClick(save);
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(updateCalls(rewards)).toHaveLength(1);
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    await waitFor(() => expect(rowNames()).toContain('Caffè lungo'));
    expect(updateCalls(rewards)).toHaveLength(1);
  });
});

describe('Modifica premio box: write errors', () => {
  const NETWORK = 'Premio non salvato: controlla la connessione e riprova.';

  it('a name already used with other capitals: the message under the name, the focus there, still changing', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await userEvent.click(editButton('Caffè 50 punti'));
    await fillEdit('APERITIVO', '50');
    await userEvent.click(editBox().save);

    await waitFor(() =>
      expect(editBox().name).toHaveAccessibleDescription('Esiste già un premio con questo nome'),
    );
    expect(editBox().name).toHaveFocus();
    expect(editBox().name).toHaveValue('APERITIVO');
    expect(rowNames()).toContain('Caffè');
    expect(updateCalls(rewards)).toHaveLength(1);
    expect(editButton('Caffè 50 punti')).toHaveAttribute('aria-current', 'true');
  });

  it('a network error keeps the fields; "Riprova" sends the same values again', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await userEvent.click(editButton('Caffè 50 punti'));
    await fillEdit('Caffè lungo', '60');
    rewards.failNext('update', 'network');
    await userEvent.click(editBox().save);

    const alert = await within(editBox().region).findByRole('alert');
    expect(alert).toHaveTextContent(NETWORK);
    expect(editBox().name).toHaveValue('Caffè lungo');
    expect(editBox().points).toHaveValue('60');
    expect(listCalls(rewards)).toHaveLength(1);
    const retry = within(editBox().region).getByRole('button', { name: 'Riprova' });
    expect(retry).toHaveFocus();

    await userEvent.click(retry);
    await waitFor(() => expect(rowNames()).toContain('Caffè lungo'));
    const id = rewards.rewards().find((r) => r.name === 'Caffè lungo')!.id;
    expect(rewards.service.update.mock.calls).toEqual([
      [id, { name: 'Caffè lungo', points: 60 }],
      [id, { name: 'Caffè lungo', points: 60 }],
    ]);
    expect(screen.queryByRole('region', { name: 'Modifica premio' })).not.toBeInTheDocument();
  });

  it('not-found: says "Premio non salvato: riprova." and reloads the list; still changing while the row is there', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await userEvent.click(editButton('Caffè 50 punti'));
    await fillEdit('Caffè lungo', '60');
    rewards.failNext('update', 'not-found');
    await userEvent.click(editBox().save);

    const alert = await within(editBox().region).findByRole('alert');
    expect(alert).toHaveTextContent('Premio non salvato: riprova.');
    await waitFor(() => expect(listCalls(rewards)).toHaveLength(2));
    expect(editBox().name).toHaveValue('Caffè lungo');
    expect(editBox().save).toHaveAccessibleName('Salva modifiche');
  });

  it('a row no longer in the reloaded list closes the change and gives back "Nuovo premio"', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await userEvent.click(editButton('Caffè 50 punti'));
    rewards.failNext('update', 'not-found');
    const others = rewards.rewards().filter((r) => r.name !== 'Caffè');
    rewards.service.listAll.mockResolvedValueOnce(others);
    await userEvent.click(editBox().save);

    await waitFor(() => expect(rowNames()).not.toContain('Caffè'));
    expect(screen.queryByRole('region', { name: 'Modifica premio' })).not.toBeInTheDocument();
    expect(box().name).toBeEnabled();
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
    const checksBefore = auth.service.loadIdentity.mock.calls.length;
    await userEvent.click(editButton('Caffè 50 punti'));
    rewards.failNext('update', 'forbidden');
    await userEvent.click(editBox().save);

    const alert = await within(editBox().region).findByRole('alert');
    expect(alert).toHaveTextContent('Solo per gli amministratori');
    await waitFor(() => expect(auth.service.loadIdentity.mock.calls.length).toBe(checksBefore + 1));
  });

  it('a server fault: its own words and "Riprova"', async () => {
    const rewards = renderCatalog();
    await screen.findByRole('list', { name: 'Premi del catalogo' });
    await userEvent.click(editButton('Caffè 50 punti'));
    rewards.failNext('update', new ServerFaultError('unavailable'));
    await userEvent.click(editBox().save);
    const alert = await within(editBox().region).findByRole('alert');
    expect(alert).toHaveTextContent('Servizio momentaneamente non disponibile: riprova tra poco.');
    await userEvent.click(within(editBox().region).getByRole('button', { name: 'Riprova' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Modifica premio' })).not.toBeInTheDocument(),
    );
    expect(updateCalls(rewards)).toHaveLength(2);
  });
});
