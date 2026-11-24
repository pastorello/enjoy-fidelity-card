import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { fakeDevice } from '../../test/fakeAuthService';
import { createFakeKioskService, fakeCashier } from '../../test/fakeKioskService';
import { renderApp, signedInFake } from '../../test/renderApp';

const SEARCH_LABEL = 'Oppure cerca per nome o email';
const CHIP = 'Alla cassa: Giulia · Cambia';

/** A device whose cashier, Giulia, has just unlocked the till; the kiosk fake drives the identity. */
function openAsDevice(path = '/') {
  const giulia = fakeCashier({ name: 'Giulia', role: 'operator', pin: '1234' });
  const kiosk = createFakeKioskService({ cashiers: [giulia], cashierId: giulia.id });
  const fake = signedInFake();
  fake.setDevice(fakeDevice, () => kiosk.device());
  const view = renderApp(
    path,
    fake,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    kiosk,
  );
  return { ...view, kiosk };
}

function banner() {
  return screen.getByRole('banner');
}

async function findChip() {
  return within(await screen.findByRole('banner')).findByRole('link', { name: CHIP });
}

async function tillShown() {
  expect(
    await screen.findByRole('heading', { level: 2, name: 'Chi è alla cassa?' }),
  ).toBeInTheDocument();
}

describe('CashierChip, "Alla cassa: <nome> · Cambia"', () => {
  it('shows the cashier in the home header, with the initial, next to the account button', async () => {
    openAsDevice();
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });

    const chip = await findChip();
    expect(chip).toHaveAttribute('href', '/cassa');
    expect(chip).toHaveTextContent(/^GAlla cassa: Giulia · Cambia$/);
    expect(
      within(banner()).getByRole('link', { name: 'Account e impostazioni: Giulia' }),
    ).toHaveAttribute('href', '/impostazioni');
  });

  it('shows the cashier on a screen with a title, after the title', async () => {
    openAsDevice('/impostazioni');
    const chip = await findChip();
    expect(within(banner()).getByRole('link', { name: 'Indietro' })).toBeInTheDocument();
    const heading = within(banner()).getByRole('heading', { level: 1 });
    expect(heading.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('"Cambia" ends the turn on the server and goes to /cassa (criterion 2)', async () => {
    const { router, kiosk } = openAsDevice();
    fireEvent.click(await findChip());

    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(kiosk.service.endTurn).toHaveBeenCalledTimes(1);
    expect(kiosk.device().cashier).toBeNull();
    await tillShown();
    // "Chi è alla cassa?" has no cashier in its header, and the turn did not "expire".
    expect(within(banner()).queryByRole('link', { name: /^Alla cassa:/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Turno scaduto: inserisci di nuovo il PIN')).not.toBeInTheDocument();
  });

  it('goes to /cassa even when the network is down', async () => {
    const { router, kiosk } = openAsDevice();
    const chip = await findChip();
    kiosk.setNetworkDown(true);
    fireEvent.click(chip);

    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(kiosk.service.endTurn).toHaveBeenCalledTimes(1);
    await tillShown();
  });

  it('goes to /cassa even when the server fails', async () => {
    const { router, kiosk } = openAsDevice();
    const chip = await findChip();
    kiosk.failNext('endTurn', new ServerFaultError('unavailable'));
    fireEvent.click(chip);

    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    await tillShown();
  });

  it('a second tap while the turn is closing sends nothing more', async () => {
    const { router, kiosk } = openAsDevice();
    const chip = await findChip();
    const held = kiosk.holdNext('endTurn');
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(router.state.location.pathname).toBe('/');

    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(kiosk.service.endTurn).toHaveBeenCalledTimes(1);
  });

  it('is not shown on an operator account (the phone)', async () => {
    renderApp('/', signedInFake());
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });
    expect(within(banner()).queryByRole('link', { name: /^Alla cassa:/ })).not.toBeInTheDocument();
  });
});
