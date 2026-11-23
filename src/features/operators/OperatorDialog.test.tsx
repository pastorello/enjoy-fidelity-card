import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeOperatorsService, fakeOperator } from '../../test/fakeOperatorsService';
import type { FakeOperator } from '../../test/fakeOperatorsService';
import { fakeDevice } from '../../test/fakeAuthService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { stubLayout } from '../../test/stubLayout';

// The person dialog of the Operators screen (SPEC-operators point 2, "Gestione della persona"),
// driven through the page as the operator uses it.

const PATH = '/impostazioni/operatori';
const GENERIC_TEXT = 'Operazione non riuscita. Riprova tra poco.';
const PROMOTE_TEXT =
  'Potrà gestire operatori, premi, punti ed esportazioni e annullare i movimenti.';
const DEMOTE_TEXT = 'Non vedrà più le impostazioni da amministratore.';
const LAST_ADMIN_TEXT =
  'Serve almeno un amministratore attivo: prima rendi amministratore un’altra persona.';
const NOT_INVITED_TEXT = 'Marco Prova ha già accettato l’invito o non è attivo: ricarica l’elenco.';
const RATE_LIMITED_TEXT =
  'Troppe email inviate in poco tempo: l’invito non è partito. Riprova tra qualche minuto.';
const PIN_MISSING_TEXT = 'Dal tablet un amministratore si conferma con il tuo PIN: riprova.';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Giulia (the caller), Andrea admin, Marco invited, Luca operator, Sara deactivated, Zeno removed. */
function team(): FakeOperator[] {
  return [
    fakeOperator({ name: 'Giulia Prova', role: 'admin', email: 'giulia@esempio.it' }),
    fakeOperator({ name: 'Andrea Prova', role: 'admin', email: 'andrea@esempio.it' }),
    fakeOperator({ name: 'Luca Prova', email: 'luca@esempio.it' }),
    fakeOperator({
      name: 'Marco Prova',
      email: 'marco@esempio.it',
      emailConfirmed: false,
      hasPassword: false,
    }),
    fakeOperator({ name: 'Sara Prova', email: 'sara@esempio.it', deactivated: true }),
    fakeOperator({ name: 'Zeno Prova', email: null }),
  ];
}

function setup(operators: FakeOperator[] = team(), options: { onDevice?: boolean } = {}) {
  const fake = createFakeOperatorsService({ operators, ...options });
  const idOf = (name: string) => {
    const found = operators.find((operator) => operator.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found.id;
  };
  return { fake, idOf };
}

function renderPage(fake: ReturnType<typeof createFakeOperatorsService>, auth = signedInFake()) {
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
  return { auth };
}

/** Taps the PIN on the keypad of the PIN step, one digit after the other. */
async function typePin(dialog: HTMLElement, pin: string) {
  const keypad = within(dialog).getByRole('group', { name: 'Tastierino PIN' });
  await pin
    .split('')
    .reduce<Promise<void>>(
      (previous, digit) =>
        previous.then(() => userEvent.click(within(keypad).getByRole('button', { name: digit }))),
      Promise.resolve(),
    );
}

async function findList() {
  return screen.findByRole('list', { name: 'Operatori del bar' });
}

function rowOf(list: HTMLElement, name: string): HTMLElement {
  const row = within(list)
    .getAllByRole('listitem')
    .find((item) => item.textContent.includes(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

/** The button that opens the dialog: the name and the state of the row. */
function personButton(list: HTMLElement, name: string): HTMLElement {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return within(rowOf(list, name)).getByRole('button', { name: new RegExp(`^${escaped}`) });
}

async function openPerson(name: string) {
  const list = await findList();
  await userEvent.click(personButton(list, name));
  return screen.getByRole('dialog', { name });
}

function messages(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[data-operators-messages]');
  if (!region) throw new Error('no messages region');
  return region;
}

function roleGroup(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('group', { name: 'Ruolo' });
}

describe('OperatorDialog: opening it', () => {
  it('opens from the name of active, invited and deactivated people; not from removed ones nor the own row', async () => {
    const { fake } = setup();
    renderPage(fake);
    const list = await findList();
    for (const name of ['Andrea Prova', 'Luca Prova', 'Marco Prova', 'Sara Prova']) {
      expect(personButton(list, name)).toBeVisible();
    }
    expect(within(rowOf(list, 'Zeno')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rowOf(list, 'Giulia')).queryByRole('button')).not.toBeInTheDocument();
    // The person button carries the state too, and the chevron of ListRow.
    expect(personButton(list, 'Marco Prova')).toHaveAccessibleName(
      'Marco Prova Operatore · invito inviato',
    );
  });

  it('shows the name as title, the email and the state, the role chosen', async () => {
    const { fake } = setup();
    renderPage(fake);
    const dialog = await openPerson('Luca Prova');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Luca Prova' })).toBeVisible();
    expect(dialog).toHaveAccessibleDescription('luca@esempio.it · attivo');
    const group = roleGroup(dialog);
    expect(within(group).getByRole('radio', { name: 'Operatore' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Amministratore' })).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Salva ruolo' })).toBeDisabled();
    // "Reinvia invito" and "Annulla invito" are for invited people only.
    expect(within(dialog).queryByRole('button', { name: 'Reinvia invito' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Annulla invito' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Chiudi' })).toHaveFocus();
  });

  it('deactivated: only the email and the state', async () => {
    const { fake } = setup();
    renderPage(fake);
    const dialog = await openPerson('Sara Prova');
    expect(dialog).toHaveAccessibleDescription(
      'sara@esempio.it · disattivato, movimenti nello storico',
    );
    expect(within(dialog).queryByRole('group', { name: 'Ruolo' })).toBeNull();
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Chiudi']);
  });

  it('sets a name Enjoy Display lacks in the body font inside the title', async () => {
    const { fake } = setup([
      fakeOperator({ name: 'Giulia Prova', role: 'admin' }),
      fakeOperator({ name: '*Stella Prova' }),
    ]);
    renderPage(fake);
    const list = await findList();
    await userEvent.click(personButton(list, '*Stella Prova'));
    const title = within(screen.getByRole('dialog')).getByRole('heading', { level: 2 });
    expect(title.querySelector('[data-body-font="true"]')).toHaveTextContent('*Stella Prova');
  });

  it('"Chiudi" returns the focus to the row', async () => {
    const { fake } = setup();
    renderPage(fake);
    const list = await findList();
    const opener = personButton(list, 'Luca Prova');
    await userEvent.click(opener);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Chiudi' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(fake.service.setRole).not.toHaveBeenCalled();
  });
});

describe('OperatorDialog: the role', () => {
  it('promotes after the second confirmation: outcome, list reloaded, focus back on the row', async () => {
    const { fake, idOf } = setup();
    renderPage(fake);
    const dialog = await openPerson('Luca Prova');
    const save = within(dialog).getByRole('button', { name: 'Salva ruolo' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    expect(save).toBeEnabled();
    // Back to the role it has: nothing to save.
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Operatore' }));
    expect(save).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(save);

    expect(within(dialog).getByText('Rendere Luca Prova amministratore?')).toBeVisible();
    expect(within(dialog).getByText(PROMOTE_TEXT)).toBeVisible();
    const confirm = within(dialog).getByRole('button', { name: 'Rendi amministratore' });
    expect(confirm).toHaveFocus();
    expect(fake.service.setRole).not.toHaveBeenCalled();

    await userEvent.click(confirm);

    await waitFor(() => expect(messages()).toHaveTextContent('Luca Prova è ora amministratore.'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.service.setRole).toHaveBeenCalledExactlyOnceWith(idOf('Luca Prova'), 'admin');
    expect(fake.service.list).toHaveBeenCalledTimes(2);
    const list = await findList();
    await waitFor(() => expect(rowOf(list, 'Luca')).toHaveTextContent('Amministratore · attivo'));
    expect(personButton(list, 'Luca Prova')).toHaveFocus();
  });

  it('demotes after the second confirmation', async () => {
    const { fake, idOf } = setup();
    renderPage(fake);
    const dialog = await openPerson('Andrea Prova');
    expect(within(dialog).getByRole('radio', { name: 'Amministratore' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Operatore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    expect(within(dialog).getByText('Rendere Andrea Prova operatore?')).toBeVisible();
    expect(within(dialog).getByText(DEMOTE_TEXT)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi operatore' }));
    await waitFor(() => expect(messages()).toHaveTextContent('Andrea Prova è ora operatore.'));
    expect(fake.service.setRole).toHaveBeenCalledExactlyOnceWith(idOf('Andrea Prova'), 'operator');
  });

  it('"Lascia com’è" (or Esc) on the confirmation goes back to the dialog, nothing sent', async () => {
    const { fake } = setup();
    renderPage(fake);
    const dialog = await openPerson('Luca Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).queryByText('Rendere Luca Prova amministratore?')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Salva ruolo' })).toHaveFocus();
    // The choice is kept.
    expect(within(dialog).getByRole('radio', { name: 'Amministratore' })).toBeChecked();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Ruolo' })).toBeVisible();
    expect(fake.service.setRole).not.toHaveBeenCalled();
  });

  it('a double tap on the confirmation sends one request; the dialog cannot be closed meanwhile', async () => {
    const { fake } = setup();
    const held = fake.holdNext('setRole');
    renderPage(fake);
    const dialog = await openPerson('Luca Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    const confirm = within(dialog).getByRole('button', { name: 'Rendi amministratore' });
    await userEvent.dblClick(confirm);
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(within(dialog).getByRole('button', { name: 'Rendi amministratore' })).toBeVisible();
    held.release();
    await waitFor(() => expect(messages()).toHaveTextContent('Luca Prova è ora amministratore.'));
    expect(fake.service.setRole).toHaveBeenCalledTimes(1);
  });

  it('last-admin: the text stays in the dialog, which can try again', async () => {
    const { fake } = setup([
      fakeOperator({ name: 'Giulia Prova', role: 'admin' }),
      fakeOperator({ name: 'Andrea Prova', role: 'admin', emailConfirmed: false }),
    ]);
    fake.failNext('setRole', 'last-admin');
    renderPage(fake);
    const dialog = await openPerson('Andrea Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Operatore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi operatore' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(LAST_ADMIN_TEXT);
    expect(messages()).toBeEmptyDOMElement();
    expect(fake.service.list).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi operatore' }));
    await waitFor(() => expect(messages()).toHaveTextContent('Andrea Prova è ora operatore.'));
  });

  it.each([
    ['self', 'Non puoi cambiare il tuo account da qui.'],
    ['admin-from-device', PIN_MISSING_TEXT],
    ['network', GENERIC_TEXT],
    ['unknown', GENERIC_TEXT],
  ] as const)('%s: the text in the dialog, nothing reloaded', async (failure, text) => {
    const { fake } = setup();
    fake.failNext('setRole', failure);
    renderPage(fake);
    const dialog = await openPerson('Luca Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi amministratore' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
    expect(messages()).toBeEmptyDOMElement();
    expect(fake.service.list).toHaveBeenCalledTimes(1);
  });

  it('a server fault: the generic text', async () => {
    const { fake } = setup();
    fake.failNext('setRole', new ServerFaultError('unavailable'));
    renderPage(fake);
    const dialog = await openPerson('Luca Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi amministratore' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(GENERIC_TEXT);
  });

  it('an account removed meanwhile: the generic text, the list reloaded, the dialog follows it', async () => {
    const { fake, idOf } = setup();
    renderPage(fake);
    const dialog = await openPerson('Luca Prova');
    fake.removeAccount(idOf('Luca Prova'));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi amministratore' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(GENERIC_TEXT);
    await waitFor(() => expect(fake.service.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialog).queryByRole('group', { name: 'Ruolo' })).toBeNull());
  });

  it('forbidden: reported to AuthProvider, the "solo amministratori" view', async () => {
    const { fake } = setup();
    fake.failNext('setRole', 'forbidden');
    const { auth } = renderPage(fake);
    const dialog = await openPerson('Luca Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi amministratore' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Solo per gli amministratori' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(auth.service.loadIdentity.mock.calls.length).toBeGreaterThan(1));
  });

  it('closing after an error clears it for the next time', async () => {
    const { fake } = setup();
    fake.failNext('setRole', 'unknown');
    renderPage(fake);
    let dialog = await openPerson('Luca Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi amministratore' }));
    await within(dialog).findByRole('alert');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));
    // Back on the first step the error is gone; "Chiudi" closes.
    expect(within(dialog).queryByRole('alert')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Chiudi' }));
    dialog = await openPerson('Luca Prova');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByRole('radio', { name: 'Operatore' })).toBeChecked();
  });

  it('tablet layout of a phone account: an admin is named without any PIN', async () => {
    stubLayout(true);
    const { fake, idOf } = setup();
    renderPage(fake);
    const dialog = await openPerson('Luca Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi amministratore' }));
    await waitFor(() => expect(messages()).toHaveTextContent('Luca Prova è ora amministratore.'));
    expect(fake.service.setRole).toHaveBeenCalledExactlyOnceWith(idOf('Luca Prova'), 'admin');
  });

  it('a device with an admin cashier: "Rendi amministratore" asks the PIN, even without the tablet layout', async () => {
    const operators = team();
    const giulia = operators[0];
    const { fake, idOf } = setup(operators, { onDevice: true });
    renderPage(
      fake,
      signedInFake({
        device: fakeDevice,
        cashier: { id: giulia?.id ?? '', name: 'Giulia Prova', role: 'admin' },
      }),
    );
    const dialog = await openPerson('Luca Prova');
    expect(within(dialog).getByRole('radio', { name: 'Amministratore' })).toBeEnabled();
    expect(roleGroup(dialog)).not.toHaveAccessibleDescription();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi amministratore' }));
    expect(
      within(dialog).getByText(
        'Per rendere Luca Prova amministratore dal tablet serve il tuo PIN.',
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole('heading', { name: 'PIN di Giulia Prova' })).toBeVisible();
    expect(fake.service.setRole).not.toHaveBeenCalled();
    await typePin(dialog, '1234');
    await waitFor(() => expect(messages()).toHaveTextContent('Luca Prova è ora amministratore.'));
    expect(fake.service.setRole).toHaveBeenCalledExactlyOnceWith(
      idOf('Luca Prova'),
      'admin',
      '1234',
    );
    expect(JSON.stringify(fake.calls)).not.toContain('1234');
  });

  it('on a device a wrong PIN stays in the PIN step; "Lascia com’è" goes back to the person', async () => {
    const operators = team();
    const giulia = operators[0];
    const { fake } = setup(operators, { onDevice: true });
    renderPage(
      fake,
      signedInFake({
        device: fakeDevice,
        cashier: { id: giulia?.id ?? '', name: 'Giulia Prova', role: 'admin' },
      }),
    );
    const dialog = await openPerson('Luca Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi amministratore' }));
    await typePin(dialog, '9999');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'PIN errato. Tentativi rimasti: 4',
    );
    expect(fake.operators().find((o) => o.name === 'Luca Prova')?.role).toBe('operator');
    expect(messages()).toBeEmptyDOMElement();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));
    expect(within(dialog).getByRole('button', { name: 'Salva ruolo' })).toHaveFocus();
  });

  it('on a device another failure after the PIN goes back to the confirmation with its text', async () => {
    const operators = team();
    const giulia = operators[0];
    const { fake } = setup(operators, { onDevice: true });
    renderPage(
      fake,
      signedInFake({
        device: fakeDevice,
        cashier: { id: giulia?.id ?? '', name: 'Giulia Prova', role: 'admin' },
      }),
    );
    const dialog = await openPerson('Luca Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi amministratore' }));
    fake.failNext('setRole', 'network');
    await typePin(dialog, '1234');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(GENERIC_TEXT);
    expect(within(dialog).getByRole('button', { name: 'Rendi amministratore' })).toBeVisible();
  });

  it('phone layout: "Amministratore" enabled, no note', async () => {
    const { fake } = setup();
    renderPage(fake);
    const dialog = await openPerson('Luca Prova');
    expect(within(dialog).getByRole('radio', { name: 'Amministratore' })).toBeEnabled();
    expect(roleGroup(dialog)).not.toHaveAccessibleDescription();
  });
});

describe('OperatorDialog: Reinvia invito', () => {
  it('only for invited people, with its note; sends a new link', async () => {
    const { fake, idOf } = setup();
    renderPage(fake);
    const dialog = await openPerson('Marco Prova');
    expect(dialog).toHaveAccessibleDescription('marco@esempio.it · invito inviato');
    const resend = within(dialog).getByRole('button', { name: 'Reinvia invito' });
    expect(resend).toHaveAttribute('data-variant', 'secondary');
    expect(resend).toHaveAccessibleDescription('Il link precedente smette di funzionare.');

    await userEvent.click(resend);

    await waitFor(() =>
      expect(messages()).toHaveTextContent('Invito inviato di nuovo a Marco Prova.'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.service.resendInvite).toHaveBeenCalledExactlyOnceWith(idOf('Marco Prova'));
    expect(fake.emails).toEqual([
      { kind: 'invite', to: 'marco@esempio.it', name: 'Marco Prova', invitedBy: 'Giulia Prova' },
    ]);
    expect(fake.service.list).toHaveBeenCalledTimes(2);
    const list = await findList();
    await waitFor(() => expect(personButton(list, 'Marco Prova')).toHaveFocus());
  });

  it('a double tap sends one email', async () => {
    const { fake } = setup();
    const held = fake.holdNext('resendInvite');
    renderPage(fake);
    const dialog = await openPerson('Marco Prova');
    const resend = within(dialog).getByRole('button', { name: 'Reinvia invito' });
    await userEvent.dblClick(resend);
    expect(resend).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Chiudi' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    held.release();
    await waitFor(() =>
      expect(messages()).toHaveTextContent('Invito inviato di nuovo a Marco Prova.'),
    );
    expect(fake.service.resendInvite).toHaveBeenCalledTimes(1);
  });

  it('not-invited (accepted meanwhile): the text in the dialog and the list reloaded', async () => {
    const { fake, idOf } = setup();
    renderPage(fake);
    const dialog = await openPerson('Marco Prova');
    fake.acceptInvite(idOf('Marco Prova'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reinvia invito' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NOT_INVITED_TEXT);
    await waitFor(() => expect(fake.service.list).toHaveBeenCalledTimes(2));
    // The dialog follows the reloaded list: no resend for an active person.
    await waitFor(() =>
      expect(within(dialog).queryByRole('button', { name: 'Reinvia invito' })).toBeNull(),
    );
    expect(dialog).toHaveAccessibleDescription('marco@esempio.it · attivo');
    expect(fake.emails).toEqual([]);
  });

  it.each([
    ['rate-limited', RATE_LIMITED_TEXT],
    ['self', 'Non puoi cambiare il tuo account da qui.'],
    ['network', GENERIC_TEXT],
    ['unknown', GENERIC_TEXT],
  ] as const)('%s: the text in the dialog', async (failure, text) => {
    const { fake } = setup();
    fake.failNext('resendInvite', failure);
    renderPage(fake);
    const dialog = await openPerson('Marco Prova');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reinvia invito' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
    expect(messages()).toBeEmptyDOMElement();
    expect(fake.service.list).toHaveBeenCalledTimes(1);
  });

  it('forbidden: the "solo amministratori" view', async () => {
    const { fake } = setup();
    fake.failNext('resendInvite', 'forbidden');
    renderPage(fake);
    const dialog = await openPerson('Marco Prova');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reinvia invito' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Solo per gli amministratori' }),
    ).toBeInTheDocument();
  });
});

describe('OperatorDialog: Annulla invito', () => {
  it('only for invited people; after the second confirmation the row has no account', async () => {
    const { fake, idOf } = setup();
    renderPage(fake);
    const dialog = await openPerson('Marco Prova');
    const cancel = within(dialog).getByRole('button', { name: 'Annulla invito' });
    expect(cancel).toHaveAttribute('data-variant', 'danger-secondary');

    await userEvent.click(cancel);

    expect(within(dialog).getByText('Annullare l’invito a Marco Prova?')).toBeVisible();
    expect(within(dialog).getByText('Il link già inviato smette di funzionare.')).toBeVisible();
    // A dangerous action starts on the safe choice.
    expect(within(dialog).getByRole('button', { name: 'Lascia com’è' })).toHaveFocus();
    const confirm = within(dialog).getByRole('button', { name: 'Annulla invito' });
    expect(confirm).toHaveAttribute('data-variant', 'danger');
    expect(fake.service.cancelInvite).not.toHaveBeenCalled();

    await userEvent.click(confirm);

    await waitFor(() => expect(messages()).toHaveTextContent('Invito a Marco Prova annullato.'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.service.cancelInvite).toHaveBeenCalledExactlyOnceWith(idOf('Marco Prova'));
    const list = await findList();
    await waitFor(() =>
      expect(rowOf(list, 'Marco')).toHaveTextContent(
        'Operatore · disattivato, movimenti nello storico',
      ),
    );
    // No account any more: no button, the focus on the row itself.
    expect(within(rowOf(list, 'Marco')).queryByRole('button')).toBeNull();
    expect(rowOf(list, 'Marco')).toHaveFocus();
  });

  it('"Lascia com’è" goes back to the dialog, focus on "Annulla invito"', async () => {
    const { fake } = setup();
    renderPage(fake);
    const dialog = await openPerson('Marco Prova');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annulla invito' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));
    expect(within(dialog).getByRole('button', { name: 'Annulla invito' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Reinvia invito' })).toBeVisible();
    expect(fake.service.cancelInvite).not.toHaveBeenCalled();
  });

  it('not-invited: the text in the dialog and the list reloaded', async () => {
    const { fake, idOf } = setup();
    renderPage(fake);
    const dialog = await openPerson('Marco Prova');
    fake.acceptInvite(idOf('Marco Prova'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annulla invito' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annulla invito' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NOT_INVITED_TEXT);
    await waitFor(() => expect(fake.service.list).toHaveBeenCalledTimes(2));
    expect(fake.operators().find((o) => o.name === 'Marco Prova')?.email).toBe('marco@esempio.it');
  });

  it.each([
    ['self', 'Non puoi cambiare il tuo account da qui.'],
    ['network', GENERIC_TEXT],
    ['unknown', GENERIC_TEXT],
  ] as const)('%s: the text in the dialog', async (failure, text) => {
    const { fake } = setup();
    fake.failNext('cancelInvite', failure);
    renderPage(fake);
    const dialog = await openPerson('Marco Prova');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annulla invito' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annulla invito' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
    expect(messages()).toBeEmptyDOMElement();
  });

  it('upstream from the function reads as the generic text', async () => {
    const { fake } = setup();
    fake.failNext('cancelInvite', new ServerFaultError('unavailable'));
    renderPage(fake);
    const dialog = await openPerson('Marco Prova');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annulla invito' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annulla invito' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(GENERIC_TEXT);
  });
});
