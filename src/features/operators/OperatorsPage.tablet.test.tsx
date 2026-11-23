import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDevice } from '../../test/fakeAuthService';
import { createFakeOperatorsService, fakeOperator } from '../../test/fakeOperatorsService';
import type { FakeOperator } from '../../test/fakeOperatorsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { stubLayout } from '../../test/stubLayout';

// The Operators screen on the till tablet at 1280×800 (SPEC-operators points 2, 3 and 6, Open
// Questions 11; wireframe "Tablet: operatori"), with an admin cashier. The layout is simulated
// with matchMedia (`stubLayout`). Inviting, naming or reactivating an admin from the tablet asks
// the cashier's PIN again (decided 2026-11-23); the fake cashier's PIN is 1234. Invented names and
// emails only.

const PATH = '/impostazioni/operatori';
const PIN_MISSING = 'Dal tablet un amministratore si conferma con il tuo PIN: riprova.';
const PIN_TITLE = 'Conferma con il PIN';

/** A deactivated admin: from a device the cashier's PIN brings them back (SPEC-operators point 7). */
function paolo(): FakeOperator {
  return fakeOperator({ name: 'Paolo Prova', role: 'admin', deactivated: true, hasPin: true });
}
const PHONE_NOTE = 'Riceverà un’email per scegliere la password.';
const TABLET_NOTE =
  'Riceverà un’email per scegliere la password; il PIN per il tablet lo imposta dal proprio telefono.';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Giulia (the cashier), Andrea admin, Marco invited, Luca operator without PIN, Sara deactivated. */
function team(): FakeOperator[] {
  return [
    fakeOperator({ name: 'Giulia Prova', role: 'admin', hasPin: true }),
    fakeOperator({ name: 'Andrea Prova', role: 'admin', hasPin: true }),
    fakeOperator({ name: 'Luca Prova' }),
    fakeOperator({ name: 'Marco Prova', emailConfirmed: false, hasPassword: false }),
    fakeOperator({ name: 'Sara Prova', deactivated: true, hasPin: true }),
  ];
}

/**
 * The tablet with Giulia, an admin, as the cashier: the fake knows it is a device. `layout` false:
 * the same device with a screen narrower than the tablet layout.
 */
function renderTablet(path = PATH, layout = true, extra: FakeOperator[] = []) {
  stubLayout(layout);
  const operators = [...team(), ...extra];
  const giulia = operators[0];
  const fake = createFakeOperatorsService({
    operators,
    actingId: giulia?.id ?? null,
    onDevice: true,
  });
  const auth = signedInFake({
    device: fakeDevice,
    cashier: { id: giulia?.id ?? '', name: 'Giulia Prova', role: 'admin' },
  });
  renderApp(
    path,
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
  return { fake };
}

function renderPhone(extra: FakeOperator[] = []) {
  stubLayout(false);
  const fake = createFakeOperatorsService({ operators: [...team(), ...extra] });
  renderApp(
    PATH,
    signedInFake(),
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
  return { fake };
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

function column() {
  return screen.getByRole('complementary', { name: 'Invita operatore' });
}

/** Taps the PIN on the keypad inside `container`, one digit after the other. */
async function typePin(container: HTMLElement, pin: string) {
  const keypad = within(container).getByRole('group', { name: 'Tastierino PIN' });
  await pin
    .split('')
    .reduce<Promise<void>>(
      (previous, digit) =>
        previous.then(() => userEvent.click(within(keypad).getByRole('button', { name: digit }))),
      Promise.resolve(),
    );
}

async function fillAdminInvite() {
  const aside = column();
  await userEvent.type(within(aside).getByRole('textbox', { name: 'Nome' }), 'Nadia Prova');
  await userEvent.type(within(aside).getByRole('textbox', { name: 'Email' }), 'nadia@esempio.it');
  await userEvent.click(within(aside).getByRole('radio', { name: 'Amministratore' }));
  return aside;
}

async function openPerson(name: string) {
  const list = await findList();
  await userEvent.click(within(rowOf(list, name)).getByRole('button', { name: new RegExp(name) }));
  return screen.findByRole('dialog', { name });
}

describe('OperatorsPage: tablet layout', () => {
  it('puts the list on the left and "Invita operatore" in the 480 px column on the right', async () => {
    renderTablet();
    const list = await findList();
    const aside = column();
    expect(aside).toHaveAttribute('data-tablet-column', 'invite-operator');
    expect(aside).toHaveAttribute('data-width', '480');
    expect(
      within(aside).getByRole('heading', { level: 2, name: 'Invita operatore' }),
    ).toBeVisible();
    expect(within(aside).getByRole('button', { name: 'Invia invito' })).toBeVisible();
    // The list is in the main column, outside the aside; one landmark for the form, not two.
    expect(aside).not.toContainElement(list);
    expect(list.closest('[data-tablet-column="main"]')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Invita operatore' })).toBeNull();
  });

  it('shows the PIN state for active and invited people, "(tu)" on the cashier', async () => {
    renderTablet();
    const list = await findList();
    expect(rowOf(list, 'Giulia')).toHaveTextContent(
      'Giulia Prova (tu) Amministratore · attivo · PIN impostato',
    );
    expect(rowOf(list, 'Luca')).toHaveTextContent('Operatore · attivo · PIN da impostare');
    expect(rowOf(list, 'Marco')).toHaveTextContent('Operatore · invito inviato · PIN da impostare');
    expect(rowOf(list, 'Sara')).toHaveTextContent(
      'Operatore · disattivato, movimenti nello storico',
    );
    expect(rowOf(list, 'Sara')).not.toHaveTextContent('PIN');
  });

  it('invite form: "Amministratore" can be chosen, the note of the button names the PIN', async () => {
    renderTablet();
    await findList();
    const aside = column();
    const role = within(aside).getByRole('group', { name: 'Ruolo' });
    expect(within(role).getByRole('radio', { name: 'Operatore' })).toBeChecked();
    expect(within(role).getByRole('radio', { name: 'Amministratore' })).toBeEnabled();
    expect(role).not.toHaveAccessibleDescription();
    expect(within(aside).getByRole('button', { name: 'Invia invito' })).toHaveAccessibleDescription(
      TABLET_NOTE,
    );
  });

  it('invite form: an operator is invited from the tablet without any PIN', async () => {
    const { fake } = renderTablet();
    await findList();
    const aside = column();
    await userEvent.type(within(aside).getByRole('textbox', { name: 'Nome' }), 'Nadia Prova');
    await userEvent.type(within(aside).getByRole('textbox', { name: 'Email' }), 'nadia@esempio.it');
    await userEvent.click(within(aside).getByRole('button', { name: 'Invia invito' }));
    expect(await screen.findByText('Invito inviato a Nadia Prova.')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: PIN_TITLE })).toBeNull();
    expect(fake.service.invite).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'Nadia Prova', role: 'operator' }),
    );
  });

  it('invite form: an admin is invited only after the PIN of the cashier, sent with the invite', async () => {
    const { fake } = renderTablet();
    await findList();
    const aside = await fillAdminInvite();
    await userEvent.click(within(aside).getByRole('button', { name: 'Invia invito' }));
    const pin = await screen.findByRole('dialog', { name: PIN_TITLE });
    expect(
      within(pin).getByText(
        'Per invitare Nadia Prova come amministratore dal tablet serve il tuo PIN.',
      ),
    ).toBeVisible();
    expect(within(pin).getByRole('heading', { name: 'PIN di Giulia Prova' })).toBeVisible();
    expect(fake.service.invite).not.toHaveBeenCalled();
    await typePin(pin, '1234');
    expect(await screen.findByText('Invito inviato a Nadia Prova.')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: PIN_TITLE })).toBeNull();
    expect(fake.service.invite).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'Nadia Prova', role: 'admin' }),
      '1234',
    );
    expect(fake.emails).toHaveLength(1);
    expect(JSON.stringify(fake.calls)).not.toContain('1234');
  });

  it('invite form: a wrong PIN stays in the PIN step, the form keeps its values', async () => {
    const { fake } = renderTablet();
    await findList();
    const aside = await fillAdminInvite();
    await userEvent.click(within(aside).getByRole('button', { name: 'Invia invito' }));
    const pin = await screen.findByRole('dialog', { name: PIN_TITLE });
    await typePin(pin, '0000');
    expect(await within(pin).findByRole('alert')).toHaveTextContent(
      'PIN errato. Tentativi rimasti: 4',
    );
    expect(fake.emails).toEqual([]);
    await userEvent.click(within(pin).getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('dialog', { name: PIN_TITLE })).toBeNull();
    expect(within(aside).getByRole('textbox', { name: 'Nome' })).toHaveValue('Nadia Prova');
    expect(within(aside).getByRole('button', { name: 'Invia invito' })).toHaveFocus();
  });

  it('invite form: the 5th wrong PIN locks the till, counted down as on /cassa', async () => {
    const { fake } = renderTablet();
    await findList();
    const aside = await fillAdminInvite();
    await userEvent.click(within(aside).getByRole('button', { name: 'Invia invito' }));
    const pin = await screen.findByRole('dialog', { name: PIN_TITLE });
    await ['0000', '0000', '0000', '0000', '0000'].reduce<Promise<void>>(
      (previous, wrong) => previous.then(() => typePin(pin, wrong)),
      Promise.resolve(),
    );
    expect(await within(pin).findByRole('timer')).toHaveTextContent(
      'Troppi tentativi: riprova tra 5:00',
    );
    expect(within(pin).getByRole('group', { name: 'Tastierino PIN' })).toBeDisabled();
    expect(fake.emails).toEqual([]);
  });

  it('invite form: admin_from_device (the PIN missing) gets its text under Ruolo', async () => {
    const { fake } = renderTablet();
    await findList();
    const aside = await fillAdminInvite();
    await userEvent.click(within(aside).getByRole('button', { name: 'Invia invito' }));
    const pin = await screen.findByRole('dialog', { name: PIN_TITLE });
    fake.failNext('invite', 'admin-from-device');
    await typePin(pin, '1234');
    const role = within(aside).getByRole('group', { name: 'Ruolo' });
    expect(await within(role).findByRole('alert')).toHaveTextContent(PIN_MISSING);
    expect(screen.queryByRole('dialog', { name: PIN_TITLE })).toBeNull();
  });

  it('invite form: a device without the tablet layout asks the PIN too', async () => {
    // The device decides, whatever the screen size.
    const { fake } = renderTablet(PATH, false);
    await findList();
    const section = screen.getByRole('region', { name: 'Invita operatore' });
    await userEvent.type(within(section).getByRole('textbox', { name: 'Nome' }), 'Nadia Prova');
    await userEvent.type(
      within(section).getByRole('textbox', { name: 'Email' }),
      'nadia@esempio.it',
    );
    await userEvent.click(within(section).getByRole('radio', { name: 'Amministratore' }));
    expect(
      within(section).getByRole('button', { name: 'Invia invito' }),
    ).toHaveAccessibleDescription(PHONE_NOTE);
    await userEvent.click(within(section).getByRole('button', { name: 'Invia invito' }));
    expect(await screen.findByRole('dialog', { name: PIN_TITLE })).toBeVisible();
    expect(fake.service.invite).not.toHaveBeenCalled();
  });

  it('person dialog: "Amministratore" can be chosen for an operator, and asks the PIN', async () => {
    const { fake } = renderTablet();
    const dialog = await openPerson('Luca Prova');
    const role = within(dialog).getByRole('group', { name: 'Ruolo' });
    expect(within(role).getByRole('radio', { name: 'Amministratore' })).toBeEnabled();
    await userEvent.click(within(role).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi amministratore' }));
    await typePin(dialog, '1234');
    expect(await screen.findByText('Luca Prova è ora amministratore.')).toBeVisible();
    expect(fake.service.setRole).toHaveBeenCalledWith(expect.any(String), 'admin', '1234');
  });

  it('person dialog: an admin is demoted from the tablet without a PIN; a refusal is told there', async () => {
    const { fake } = renderTablet();
    const dialog = await openPerson('Andrea Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Operatore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    fake.failNext('setRole', 'admin-from-device');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi operatore' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(PIN_MISSING);
    expect(fake.service.setRole).toHaveBeenCalledWith(expect.any(String), 'operator');
  });

  it('a deactivated admin has "Riattiva": confirmed, it asks the PIN, then is active again', async () => {
    const extra = paolo();
    const { fake } = renderTablet(PATH, true, [extra]);
    const list = await findList();
    await userEvent.click(
      within(rowOf(list, 'Paolo Prova')).getByRole('button', { name: 'Riattiva' }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Riattivare Paolo Prova?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Riattiva' }));
    const pin = await screen.findByRole('dialog', { name: PIN_TITLE });
    expect(
      within(pin).getByText(
        'Per riattivare Paolo Prova, amministratore, dal tablet serve il tuo PIN.',
      ),
    ).toBeVisible();
    expect(fake.service.setActive).not.toHaveBeenCalled();
    await typePin(pin, '9999');
    expect(await within(pin).findByRole('alert')).toHaveTextContent(
      'PIN errato. Tentativi rimasti: 4',
    );
    await typePin(pin, '1234');
    expect(await screen.findByText('Paolo Prova è di nuovo attivo.')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fake.service.setActive).toHaveBeenLastCalledWith(extra.id, true, '1234');
  });

  it('a reactivation refused after the PIN goes back to the confirmation with its text', async () => {
    const { fake } = renderTablet(PATH, true, [paolo()]);
    const list = await findList();
    await userEvent.click(
      within(rowOf(list, 'Paolo Prova')).getByRole('button', { name: 'Riattiva' }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Riattiva' }),
    );
    const pin = await screen.findByRole('dialog', { name: PIN_TITLE });
    fake.failNext('setActive', 'last-admin');
    await typePin(pin, '1234');
    const confirm = await screen.findByRole('dialog', { name: 'Riattivare Paolo Prova?' });
    expect(within(confirm).getByRole('alert')).toHaveTextContent(
      'Serve almeno un amministratore attivo',
    );
  });

  it('a deactivated operator is reactivated from the tablet without a PIN', async () => {
    const { fake } = renderTablet();
    const list = await findList();
    await userEvent.click(
      within(rowOf(list, 'Sara Prova')).getByRole('button', { name: 'Riattiva' }),
    );
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Riattiva' }));
    expect(await screen.findByText('Sara Prova è di nuovo attivo.')).toBeVisible();
    expect(fake.service.setActive).toHaveBeenCalledExactlyOnceWith(expect.any(String), true);
  });

  it('a device without the tablet layout offers "Riattiva" for an admin as well', async () => {
    renderTablet(PATH, false, [paolo()]);
    const row = rowOf(await findList(), 'Paolo Prova');
    expect(within(row).getByRole('button', { name: 'Riattiva' })).toBeVisible();
  });

  it('settings row: "Account, ruoli, inviti e PIN"', async () => {
    renderTablet('/impostazioni');
    const row = await screen.findByRole('link', { name: /Operatori/ });
    expect(row).toHaveTextContent('Account, ruoli, inviti e PIN');
    expect(row).toHaveAttribute('href', PATH);
  });
});

describe('OperatorsPage: phone layout unchanged', () => {
  it('a deactivated admin is reactivated from the phone without any PIN', async () => {
    const extra = paolo();
    const { fake } = renderPhone([extra]);
    const row = rowOf(await findList(), 'Paolo Prova');
    await userEvent.click(within(row).getByRole('button', { name: 'Riattiva' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Riattiva' }),
    );
    expect(await screen.findByText('Paolo Prova è di nuovo attivo.')).toBeVisible();
    expect(fake.service.setActive).toHaveBeenCalledExactlyOnceWith(extra.id, true);
  });

  it('an admin is invited from the phone without any PIN', async () => {
    const { fake } = renderPhone();
    await findList();
    const section = screen.getByRole('region', { name: 'Invita operatore' });
    await userEvent.type(within(section).getByRole('textbox', { name: 'Nome' }), 'Nadia Prova');
    await userEvent.type(
      within(section).getByRole('textbox', { name: 'Email' }),
      'nadia@esempio.it',
    );
    await userEvent.click(within(section).getByRole('radio', { name: 'Amministratore' }));
    await userEvent.click(within(section).getByRole('button', { name: 'Invia invito' }));
    expect(await screen.findByText('Invito inviato a Nadia Prova.')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: PIN_TITLE })).toBeNull();
    expect(fake.service.invite).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ role: 'admin' }),
    );
  });

  it('keeps the form in the footer region, "Amministratore" enabled, the phone note', async () => {
    renderPhone();
    const list = await findList();
    expect(screen.queryByRole('complementary', { name: 'Invita operatore' })).toBeNull();
    expect(document.querySelector('[data-tablet]')).toBeNull();
    const section = screen.getByRole('region', { name: 'Invita operatore' });
    expect(section).not.toContainElement(list);
    const role = within(section).getByRole('group', { name: 'Ruolo' });
    expect(within(role).getByRole('radio', { name: 'Amministratore' })).toBeEnabled();
    expect(role).not.toHaveAccessibleDescription();
    expect(
      within(section).getByRole('button', { name: 'Invia invito' }),
    ).toHaveAccessibleDescription(PHONE_NOTE);
    expect(list).not.toHaveTextContent('PIN');
  });
});
