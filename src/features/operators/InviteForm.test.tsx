import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeOperatorsService, fakeOperator } from '../../test/fakeOperatorsService';
import type { FakeOperator } from '../../test/fakeOperatorsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import type { InviteInput } from './types';

// "Invita operatore" at the bottom of the Operators screen (SPEC-operators points 3 and 6),
// driven through the page as the administrator uses it.

const PATH = '/impostazioni/operatori';
const GENERIC_TEXT = 'Operazione non riuscita. Riprova tra poco.';
const NETWORK_TEXT = 'Connessione assente: l’invito potrebbe non essere partito. Riprova.';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Giulia (the caller), Sara deactivated, Zeno removed. */
function team(): FakeOperator[] {
  return [
    fakeOperator({ name: 'Giulia Prova', role: 'admin', email: 'giulia@esempio.it' }),
    fakeOperator({ name: 'Sara Prova', email: 'sara@esempio.it', deactivated: true }),
    fakeOperator({ name: 'Zeno Prova', email: null }),
  ];
}

function renderPage(fake = createFakeOperatorsService({ operators: team() })) {
  const auth = signedInFake();
  renderApp(
    PATH,
    auth,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fake,
  );
  return { fake, auth };
}

async function findForm() {
  await screen.findByRole('list', { name: 'Operatori del bar' });
  const section = screen.getByRole('region', { name: 'Invita operatore' });
  return {
    section,
    name: within(section).getByRole('textbox', { name: 'Nome' }),
    email: within(section).getByRole('textbox', { name: 'Email' }),
    role: within(section).getByRole('group', { name: 'Ruolo' }),
    operator: within(section).getByRole('radio', { name: 'Operatore' }),
    admin: within(section).getByRole('radio', { name: 'Amministratore' }),
    send: within(section).getByRole('button', { name: 'Invia invito' }),
  };
}

type Form = Awaited<ReturnType<typeof findForm>>;

async function fill(form: Form, name: string, email: string) {
  await userEvent.clear(form.name);
  if (name) await userEvent.type(form.name, name);
  await userEvent.clear(form.email);
  if (email) await userEvent.type(form.email, email);
}

function invites(fake: ReturnType<typeof createFakeOperatorsService>): InviteInput[] {
  return fake.service.invite.mock.calls.map(([input]) => input);
}

/** The alert under the button: after it in the document, inside the section. */
async function failureUnderButton(form: Form, text: string) {
  const alert = await within(form.section).findByRole('alert');
  expect(alert).toHaveTextContent(text);
  expect(form.send.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  return alert;
}

describe('InviteForm: the form', () => {
  it('has Nome, Email, Ruolo (Operatore chosen), "Invia invito" and the note, as the wireframe', async () => {
    renderPage();
    const form = await findForm();
    expect(
      within(form.section).getByRole('heading', { level: 2, name: 'Invita operatore' }),
    ).toBeInTheDocument();
    expect(form.name).toHaveAttribute('placeholder', 'Es. Marco');
    expect(form.name).toHaveAttribute('autocomplete', 'off');
    expect(form.email).toHaveAttribute('type', 'email');
    expect(form.email).toHaveAttribute('inputmode', 'email');
    expect(form.email).toHaveAttribute('autocomplete', 'off');
    expect(form.email).toHaveAttribute('placeholder', 'nome@esempio.it');
    expect(form.operator).toBeChecked();
    expect(form.admin).not.toBeChecked();
    expect(form.admin).toBeEnabled();
    expect(form.send).toHaveAttribute('type', 'submit');
    expect(form.section).toHaveTextContent('Riceverà un’email per scegliere la password.');
  });
});

describe('InviteForm: local checks', () => {
  it('empty: both messages under their fields, the focus on Nome, nothing sent', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await userEvent.click(form.send);
    expect(form.name).toHaveAccessibleDescription('Inserisci il nome');
    expect(form.email).toHaveAccessibleDescription('Inserisci l’email');
    expect(form.name).toHaveFocus();
    expect(invites(fake)).toEqual([]);
  });

  it('a name over 60 characters and a wrong email: the focus on the first wrong field', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'a'.repeat(61), 'marco@esempio');
    await userEvent.click(form.send);
    expect(form.name).toHaveAccessibleDescription('Al massimo 60 caratteri');
    expect(form.email).toHaveAccessibleDescription('Email non valida');
    expect(form.name).toHaveFocus();

    await fill(form, 'Marco', 'marco@esempio');
    await userEvent.click(form.send);
    expect(form.name).not.toHaveAccessibleDescription();
    expect(form.email).toHaveAccessibleDescription('Email non valida');
    expect(form.email).toHaveFocus();
    expect(invites(fake)).toEqual([]);
  });

  it('an email over 254 characters is not valid', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco', `${'a'.repeat(250)}@esempio.it`);
    await userEvent.click(form.send);
    expect(form.email).toHaveAccessibleDescription('Email non valida');
    expect(invites(fake)).toEqual([]);
  });

  it('a field message goes once that field changes', async () => {
    renderPage();
    const form = await findForm();
    await userEvent.click(form.send);
    await userEvent.type(form.name, 'M');
    expect(form.name).not.toHaveAccessibleDescription();
    expect(form.email).toHaveAccessibleDescription('Inserisci l’email');
  });
});

describe('InviteForm: sending', () => {
  it('sends the name cleaned as the server does, then empties the form, says so and reloads the list', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, '  Marco\u00a0\u00a0 Bianchi ', ' marco.b@esempio.it ');
    await userEvent.click(form.admin);
    await userEvent.click(form.send);

    expect(await screen.findByText('Invito inviato a Marco Bianchi.')).toBeInTheDocument();
    const [sent] = invites(fake);
    expect(sent?.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(sent).toEqual({
      operationId: sent?.operationId,
      name: 'Marco Bianchi',
      email: 'marco.b@esempio.it',
      role: 'admin',
    });
    expect(form.name).toHaveValue('');
    expect(form.email).toHaveValue('');
    expect(form.operator).toBeChecked();
    const list = screen.getByRole('list', { name: 'Operatori del bar' });
    await waitFor(() =>
      expect(within(list).getByText('Marco Bianchi').closest('li')).toHaveTextContent(
        'Amministratore · invito inviato',
      ),
    );
    expect(fake.emails).toHaveLength(1);
    expect(fake.calls.filter((call) => call.method === 'list')).toHaveLength(2);
  });

  it('a new invite after a success gets a new operation_id', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    await userEvent.click(form.send);
    await screen.findByText('Invito inviato a Marco Prova.');
    await fill(form, 'Luca Prova', 'luca@esempio.it');
    await userEvent.click(form.send);
    await screen.findByText('Invito inviato a Luca Prova.');
    const [first, second] = invites(fake);
    expect(first?.operationId).not.toBe(second?.operationId);
    expect(fake.emails).toHaveLength(2);
  });

  it('a double tap sends one invite; the button is busy meanwhile', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    const held = fake.holdNext('invite');
    await userEvent.dblClick(form.send);
    expect(form.send).toHaveAttribute('aria-busy', 'true');
    expect(invites(fake)).toHaveLength(1);
    held.release();
    expect(await screen.findByText('Invito inviato a Marco Prova.')).toBeInTheDocument();
    expect(form.send).not.toHaveAttribute('aria-busy', 'true');
    expect(fake.emails).toHaveLength(1);
  });

  it('no answer: the text under the button, the fields kept; a new tap reuses the operation_id', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    // The invite is applied, the answer is lost.
    fake.failNext('invite', 'lost');
    await userEvent.click(form.send);
    await failureUnderButton(form, NETWORK_TEXT);
    expect(form.name).toHaveValue('Marco Prova');
    expect(form.email).toHaveValue('marco@esempio.it');

    await userEvent.click(form.send);
    expect(await screen.findByText('Invito inviato a Marco Prova.')).toBeInTheDocument();
    const [first, second] = invites(fake);
    expect(second?.operationId).toBe(first?.operationId);
    // One email, one profile.
    expect(fake.emails).toHaveLength(1);
    expect(fake.operators().filter((operator) => operator.name === 'Marco Prova')).toHaveLength(1);
  });

  it('no answer, then a field changed: a new operation_id', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    fake.failNext('invite', 'network');
    await userEvent.click(form.send);
    await failureUnderButton(form, NETWORK_TEXT);

    await fill(form, 'Marco Prova', 'marco.prova@esempio.it');
    await userEvent.click(form.send);
    await screen.findByText('Invito inviato a Marco Prova.');
    const [first, second] = invites(fake);
    expect(second?.operationId).not.toBe(first?.operationId);
  });

  it('no answer, then the role changed: a new operation_id', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    fake.failNext('invite', 'network');
    await userEvent.click(form.send);
    await failureUnderButton(form, NETWORK_TEXT);

    await userEvent.click(form.admin);
    await userEvent.click(form.send);
    await screen.findByText('Invito inviato a Marco Prova.');
    const [first, second] = invites(fake);
    expect(second?.operationId).not.toBe(first?.operationId);
    expect(second?.role).toBe('admin');
  });

  it('no answer, then only a space added: what is sent is the same, so is the operation_id', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    fake.failNext('invite', 'network');
    await userEvent.click(form.send);
    await failureUnderButton(form, NETWORK_TEXT);

    await userEvent.type(form.name, ' ');
    await userEvent.click(form.send);
    await screen.findByText('Invito inviato a Marco Prova.');
    const [first, second] = invites(fake);
    expect(second?.operationId).toBe(first?.operationId);
  });
});

describe('InviteForm: the errors of point 6', () => {
  it('name_taken: under Nome, the fields kept', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'giulia prova', 'giulia.b@esempio.it');
    await userEvent.click(form.send);
    await waitFor(() =>
      expect(form.name).toHaveAccessibleDescription(
        'Nome già usato: per gli omonimi aggiungi un dettaglio (es. Marco B.).',
      ),
    );
    expect(form.name).toHaveFocus();
    expect(form.email).toHaveValue('giulia.b@esempio.it');
    expect(within(form.section).queryByRole('alert')).not.toBeInTheDocument();
    expect(fake.emails).toEqual([]);
  });

  it('email_taken: under Email', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Giulia B.', 'giulia@esempio.it');
    await userEvent.click(form.send);
    await waitFor(() =>
      expect(form.email).toHaveAccessibleDescription('Questa email ha già un account.'),
    );
    expect(form.email).toHaveFocus();
    expect(fake.emails).toEqual([]);
  });

  it('email_taken of a deactivated person: under Email, with the way to reactivate', async () => {
    renderPage();
    const form = await findForm();
    await fill(form, 'Sara B.', 'sara@esempio.it');
    await userEvent.click(form.send);
    await waitFor(() =>
      expect(form.email).toHaveAccessibleDescription(
        'Questa email è di una persona disattivata: riattivala dall’elenco.',
      ),
    );
  });

  it('email_is_device: under Email', async () => {
    const fake = createFakeOperatorsService({
      operators: team(),
      deviceEmails: ['cassa@esempio.it'],
    });
    renderPage(fake);
    const form = await findForm();
    await fill(form, 'Cassa', 'cassa@esempio.it');
    await userEvent.click(form.send);
    await waitFor(() =>
      expect(form.email).toHaveAccessibleDescription(
        'Questa è l’email dell’account del tablet: usane un’altra.',
      ),
    );
  });

  it('rate_limited: under the button', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    fake.failNext('invite', 'rate-limited');
    await userEvent.click(form.send);
    await failureUnderButton(
      form,
      'Troppe email inviate in poco tempo: l’invito non è partito. Riprova tra qualche minuto.',
    );
    expect(form.name).toHaveValue('Marco Prova');
  });

  it('in_progress: under the button', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    fake.failNext('invite', 'in-progress');
    await userEvent.click(form.send);
    await failureUnderButton(form, 'L’invito è ancora in corso: riprova tra qualche secondo.');
    expect(form.name).toHaveValue('Marco Prova');
    expect(fake.emails).toEqual([]);
  });

  it('admin_from_device: under Ruolo', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    await userEvent.click(form.admin);
    fake.failNext('invite', 'admin-from-device');
    await userEvent.click(form.send);
    await waitFor(() =>
      expect(form.role).toHaveAccessibleDescription('Un amministratore si nomina dal telefono.'),
    );
    // Announced, and not under the button.
    const alert = within(form.role).getByRole('alert');
    expect(
      form.send.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it('upstream and anything else: the generic text under the button', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    fake.failNext('invite', 'unknown');
    await userEvent.click(form.send);
    await failureUnderButton(form, GENERIC_TEXT);
    expect(form.name).toHaveValue('Marco Prova');
    expect(fake.emails).toEqual([]);
  });

  it('a server fault: the generic text under the button', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    fake.failNext('invite', new ServerFaultError('unavailable'));
    await userEvent.click(form.send);
    await failureUnderButton(form, GENERIC_TEXT);
    expect(form.name).toHaveValue('Marco Prova');
    expect(fake.emails).toEqual([]);
  });

  it('a failure under the button goes with the next send', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    fake.failNext('invite', 'in-progress');
    await userEvent.click(form.send);
    await failureUnderButton(form, 'L’invito è ancora in corso');
    await userEvent.click(form.send);
    await screen.findByText('Invito inviato a Marco Prova.');
    expect(within(form.section).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('forbidden: reported to AuthProvider, the "solo amministratori" view', async () => {
    const { fake, auth } = renderPage();
    const form = await findForm();
    await fill(form, 'Marco Prova', 'marco@esempio.it');
    fake.failNext('invite', 'forbidden');
    await userEvent.click(form.send);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Solo per gli amministratori' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Invita operatore' })).not.toBeInTheDocument();
    await waitFor(() => expect(auth.service.loadIdentity.mock.calls.length).toBeGreaterThan(1));
  });

  it('a profile removed with the same name is relinked: the same outcome', async () => {
    const { fake } = renderPage();
    const form = await findForm();
    await fill(form, 'Zeno Prova', 'zeno.nuovo@esempio.it');
    await userEvent.click(form.send);
    expect(await screen.findByText('Invito inviato a Zeno Prova.')).toBeInTheDocument();
    expect(fake.operators().find((operator) => operator.name === 'Zeno Prova')?.email).toBe(
      'zeno.nuovo@esempio.it',
    );
  });
});
