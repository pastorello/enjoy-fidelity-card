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
// with matchMedia (`stubLayout`). Invented names and emails only.

const PATH = '/impostazioni/operatori';
const INVITE_FROM_PHONE = 'Un amministratore si invita dal telefono.';
const NAME_FROM_PHONE = 'Un amministratore si nomina dal telefono.';
const REACTIVATE_FROM_PHONE = 'Un amministratore si riattiva dal telefono.';

/** A deactivated admin: from a device only the phone brings them back (SPEC-operators point 7). */
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

  it('invite form: "Amministratore" disabled with its note, the note of the button names the PIN', async () => {
    renderTablet();
    await findList();
    const aside = column();
    const role = within(aside).getByRole('group', { name: 'Ruolo' });
    expect(within(role).getByRole('radio', { name: 'Operatore' })).toBeChecked();
    expect(within(role).getByRole('radio', { name: 'Amministratore' })).toBeDisabled();
    expect(role).toHaveAccessibleDescription(INVITE_FROM_PHONE);
    expect(within(aside).getByRole('button', { name: 'Invia invito' })).toHaveAccessibleDescription(
      TABLET_NOTE,
    );
  });

  it('invite form: an operator is invited from the tablet', async () => {
    const { fake } = renderTablet();
    await findList();
    const aside = column();
    await userEvent.type(within(aside).getByRole('textbox', { name: 'Nome' }), 'Nadia Prova');
    await userEvent.type(within(aside).getByRole('textbox', { name: 'Email' }), 'nadia@esempio.it');
    await userEvent.click(within(aside).getByRole('button', { name: 'Invia invito' }));
    expect(await screen.findByText('Invito inviato a Nadia Prova.')).toBeVisible();
    expect(fake.service.invite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Nadia Prova', role: 'operator' }),
    );
  });

  it('invite form: admin_from_device gets the text of point 6 under Ruolo', async () => {
    const { fake } = renderTablet();
    await findList();
    const aside = column();
    await userEvent.type(within(aside).getByRole('textbox', { name: 'Nome' }), 'Nadia Prova');
    await userEvent.type(within(aside).getByRole('textbox', { name: 'Email' }), 'nadia@esempio.it');
    fake.failNext('invite', 'admin-from-device');
    await userEvent.click(within(aside).getByRole('button', { name: 'Invia invito' }));
    const role = within(aside).getByRole('group', { name: 'Ruolo' });
    expect(await within(role).findByRole('alert')).toHaveTextContent(NAME_FROM_PHONE);
    expect(role).toHaveAccessibleDescription(`${NAME_FROM_PHONE} ${INVITE_FROM_PHONE}`);
  });

  it('person dialog: "Amministratore" disabled for an operator, with "si nomina dal telefono"', async () => {
    renderTablet();
    const dialog = await openPerson('Luca Prova');
    const role = within(dialog).getByRole('group', { name: 'Ruolo' });
    expect(within(role).getByRole('radio', { name: 'Amministratore' })).toBeDisabled();
    expect(role).toHaveAccessibleDescription(NAME_FROM_PHONE);
  });

  it('person dialog: admin_from_device gets the text of point 6', async () => {
    const { fake } = renderTablet();
    // An admin can be demoted from the tablet; a refusal of the server is told in the dialog.
    const dialog = await openPerson('Andrea Prova');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Operatore' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salva ruolo' }));
    fake.failNext('setRole', 'admin-from-device');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rendi operatore' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NAME_FROM_PHONE);
  });

  it('invite form: a device without the tablet layout cannot invite an admin either', async () => {
    // Same rule as the person dialog: the device decides, whatever the screen size.
    renderTablet(PATH, false);
    await findList();
    const section = screen.getByRole('region', { name: 'Invita operatore' });
    const role = within(section).getByRole('group', { name: 'Ruolo' });
    expect(within(role).getByRole('radio', { name: 'Amministratore' })).toBeDisabled();
    expect(role).toHaveAccessibleDescription(INVITE_FROM_PHONE);
    expect(
      within(section).getByRole('button', { name: 'Invia invito' }),
    ).toHaveAccessibleDescription(PHONE_NOTE);
  });

  it('a deactivated admin has no "Riattiva", with "si riattiva dal telefono"; a deactivated operator has it', async () => {
    renderTablet(PATH, true, [paolo()]);
    const list = await findList();
    const row = rowOf(list, 'Paolo Prova');
    expect(within(row).queryByRole('button', { name: 'Riattiva' })).toBeNull();
    expect(row).toHaveTextContent(REACTIVATE_FROM_PHONE);
    const sara = rowOf(list, 'Sara Prova');
    expect(within(sara).getByRole('button', { name: 'Riattiva' })).toBeVisible();
    expect(sara).not.toHaveTextContent(REACTIVATE_FROM_PHONE);
  });

  it('a device without the tablet layout does not offer "Riattiva" for an admin either', async () => {
    renderTablet(PATH, false, [paolo()]);
    const row = rowOf(await findList(), 'Paolo Prova');
    expect(within(row).queryByRole('button', { name: 'Riattiva' })).toBeNull();
    expect(row).toHaveTextContent(REACTIVATE_FROM_PHONE);
  });

  it('the person dialog of a deactivated admin says it is reactivated from the phone', async () => {
    renderTablet(PATH, true, [paolo()]);
    const dialog = await openPerson('Paolo Prova');
    expect(dialog).toHaveTextContent(REACTIVATE_FROM_PHONE);
  });

  it('a reactivation refused with admin_from_device is told in the dialog', async () => {
    const { fake } = renderTablet();
    const list = await findList();
    await userEvent.click(
      within(rowOf(list, 'Sara Prova')).getByRole('button', { name: 'Riattiva' }),
    );
    const confirm = await screen.findByRole('dialog');
    fake.failNext('setActive', 'admin-from-device');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Riattiva' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(REACTIVATE_FROM_PHONE);
  });

  it('settings row: "Account, ruoli, inviti e PIN"', async () => {
    renderTablet('/impostazioni');
    const row = await screen.findByRole('link', { name: /Operatori/ });
    expect(row).toHaveTextContent('Account, ruoli, inviti e PIN');
    expect(row).toHaveAttribute('href', PATH);
  });
});

describe('OperatorsPage: phone layout unchanged', () => {
  it('a deactivated admin can be reactivated from the phone', async () => {
    renderPhone([paolo()]);
    const row = rowOf(await findList(), 'Paolo Prova');
    expect(within(row).getByRole('button', { name: 'Riattiva' })).toBeVisible();
    expect(row).not.toHaveTextContent(REACTIVATE_FROM_PHONE);
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
