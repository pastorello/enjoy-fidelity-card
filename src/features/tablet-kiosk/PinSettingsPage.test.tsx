import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { fakeDevice } from '../../test/fakeAuthService';
import { createFakeKioskService, fakeCashier } from '../../test/fakeKioskService';
import { renderApp, signedInFake } from '../../test/renderApp';

const NETWORK = 'Connessione assente. Riprova.';
const DIFFERENT = 'I due PIN sono diversi';

/**
 * /impostazioni/pin on an operator's phone: the auth fake reads whether a PIN is set from the
 * kiosk fake, so a saved PIN shows in Impostazioni as on the server.
 */
function openPinPage({ pin = null as string | null, path = '/impostazioni/pin' } = {}) {
  const marco = fakeCashier({ name: 'Marco Prova', pin });
  const kiosk = createFakeKioskService({
    cashiers: [marco],
    account: { kind: 'operator', operatorId: marco.id },
  });
  const fake = signedInFake({
    operator: { id: marco.id, name: marco.name, role: marco.role },
    hasPin: () => kiosk.hasPin(marco.id),
  });
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
  return { ...view, kiosk, marco };
}

function keypad() {
  return screen.getByRole('group', { name: 'Tastierino PIN' });
}

/** Taps the digits one after the other, as a finger would. */
async function type(digits: string) {
  await digits.split('').reduce(async (previous, digit) => {
    await previous;
    await userEvent.click(within(keypad()).getByRole('button', { name: digit }));
  }, Promise.resolve());
}

async function findStep(name: 'Scegli il PIN' | 'Ripeti il PIN') {
  return screen.findByRole('heading', { level: 2, name });
}

describe('PIN della cassa (/impostazioni/pin)', () => {
  it('asks for the PIN, then to repeat it, with the dots empty each time', async () => {
    openPinPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'PIN della cassa' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/impostazioni');
    await findStep('Scegli il PIN');
    await type('24');
    expect(screen.getByRole('img', { name: '2 cifre su 4 inserite' })).toBeInTheDocument();
    await type('68');
    await findStep('Ripeti il PIN');
    expect(screen.getByRole('img', { name: '0 cifre su 4 inserite' })).toBeInTheDocument();
  });

  it('a different repetition says so and starts again, saving nothing', async () => {
    const { kiosk, marco } = openPinPage();
    await findStep('Scegli il PIN');
    await type('2468');
    await findStep('Ripeti il PIN');
    await type('2469');
    expect(await screen.findByRole('alert')).toHaveTextContent(DIFFERENT);
    await findStep('Scegli il PIN');
    expect(screen.getByRole('img', { name: '0 cifre su 4 inserite' })).toBeInTheDocument();
    expect(kiosk.service.setMyPin).not.toHaveBeenCalled();
    expect(kiosk.hasPin(marco.id)).toBe(false);

    // Starting again clears the message and works as the first time.
    await type('1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await type('357');
    await findStep('Ripeti il PIN');
  });

  it('saved: "PIN salvato" in Impostazioni, whose row now says "Impostato"', async () => {
    const { kiosk, marco, router } = openPinPage();
    await findStep('Scegli il PIN');
    await type('2468');
    await findStep('Ripeti il PIN');
    await type('2468');
    await waitFor(() => expect(router.state.location.pathname).toBe('/impostazioni'));
    expect(kiosk.service.setMyPin).toHaveBeenCalledOnce();
    expect(kiosk.service.setMyPin).toHaveBeenCalledWith('2468');
    expect(kiosk.hasPin(marco.id)).toBe(true);

    const section = await screen.findByRole('region', { name: 'ACCOUNT' });
    expect(await within(section).findByText('PIN salvato.')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /PIN della cassa/ })).toHaveTextContent(
      'Impostato',
    );
    // The PIN never travels in the navigation.
    expect(JSON.stringify(router.state.location)).not.toContain('2468');
  });

  it('the keypad is off while the PIN is being saved', async () => {
    const { kiosk } = openPinPage();
    await findStep('Scegli il PIN');
    await type('2468');
    await findStep('Ripeti il PIN');
    const held = kiosk.holdNext('setMyPin');
    await type('2468');
    await waitFor(() => expect(keypad()).toBeDisabled());
    held.release();
    await screen.findByRole('region', { name: 'ACCOUNT' });
    expect(kiosk.service.setMyPin).toHaveBeenCalledOnce();
  });

  it('without a connection: "Connessione assente. Riprova." and the PIN to enter again', async () => {
    const { kiosk, marco, router } = openPinPage();
    await findStep('Scegli il PIN');
    kiosk.setNetworkDown(true);
    await type('2468');
    await findStep('Ripeti il PIN');
    await type('2468');
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK);
    await findStep('Scegli il PIN');
    expect(screen.getByRole('img', { name: '0 cifre su 4 inserite' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/impostazioni/pin');
    // No automatic retry.
    expect(kiosk.service.setMyPin).toHaveBeenCalledOnce();
    expect(kiosk.hasPin(marco.id)).toBe(false);

    kiosk.setNetworkDown(false);
    await type('2468');
    await findStep('Ripeti il PIN');
    await type('2468');
    await waitFor(() => expect(router.state.location.pathname).toBe('/impostazioni'));
    expect(kiosk.hasPin(marco.id)).toBe(true);
  });

  it('another failure says the PIN was not saved and starts again', async () => {
    const { kiosk } = openPinPage();
    await findStep('Scegli il PIN');
    kiosk.failNext('setMyPin', 'unknown');
    await type('2468');
    await findStep('Ripeti il PIN');
    await type('2468');
    expect(await screen.findByRole('alert')).toHaveTextContent('PIN non salvato. Riprova.');
    await findStep('Scegli il PIN');
  });

  it('a server fault says the service is unavailable', async () => {
    const { kiosk } = openPinPage();
    await findStep('Scegli il PIN');
    kiosk.failNext('setMyPin', new ServerFaultError('unavailable'));
    await type('2468');
    await findStep('Ripeti il PIN');
    await type('2468');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Servizio momentaneamente non disponibile: riprova tra poco.',
    );
  });

  it('refused (not an operator account any more): the identity is checked again', async () => {
    const { kiosk, fake, router } = openPinPage();
    await findStep('Scegli il PIN');
    kiosk.failNext('setMyPin', 'forbidden');
    fake.removeProfile();
    await type('2468');
    await findStep('Ripeti il PIN');
    await type('2468');
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });

  it('a PIN already set can be replaced without the old one', async () => {
    const { kiosk, router } = openPinPage({ pin: '1111' });
    await findStep('Scegli il PIN');
    await type('2468');
    await findStep('Ripeti il PIN');
    await type('2468');
    await waitFor(() => expect(router.state.location.pathname).toBe('/impostazioni'));
    expect(kiosk.service.setMyPin).toHaveBeenCalledWith('2468');
  });

  it('does not exist on the till tablet: a device session goes to /', async () => {
    const cashier = fakeCashier({ name: 'Marco Prova' });
    const kiosk = createFakeKioskService({ cashiers: [cashier], cashierId: cashier.id });
    const fake = signedInFake();
    fake.setDevice(fakeDevice, () => kiosk.device());
    const { router } = renderApp(
      '/impostazioni/pin',
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
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.queryByRole('group', { name: 'Tastierino PIN' })).not.toBeInTheDocument();
    expect(kiosk.service.setMyPin).not.toHaveBeenCalled();
  });
});
