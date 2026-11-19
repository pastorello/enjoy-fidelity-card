import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeDevice } from '../../test/fakeAuthService';
import { createFakeKioskService, fakeCashier } from '../../test/fakeKioskService';
import { createFakeSettingsService, defaultSettings } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import type { UpdateSettingsResult } from '../settings/types';

// SPEC-tablet-kiosk, point 9 and Open Questions 14: "LETTORE CARD" only on the till tablet with an
// administrator at the till; it saves the format with ratio and threshold read again from the server.

const SECTION = 'LETTORE CARD';
const OPTIONS = [
  ['Esadecimale', 'hex'],
  ['Esadecimale, byte invertiti', 'hex-reversed'],
  ['Decimale', 'dec'],
  ['Decimale, byte invertiti', 'dec-reversed'],
] as const;

function openOnTablet(
  role: 'admin' | 'operator',
  settings = createFakeSettingsService(),
  fake = signedInFake(),
) {
  const giulia = fakeCashier({ name: 'Giulia', role, pin: '1234' });
  const kiosk = createFakeKioskService({ cashiers: [giulia], cashierId: giulia.id });
  fake.setDevice(fakeDevice, () => kiosk.device());
  const view = renderApp(
    '/impostazioni',
    fake,
    settings,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    kiosk,
  );
  return { ...view, fake, kiosk, settings };
}

async function openSection(settings = createFakeSettingsService(), fake = signedInFake()) {
  const view = openOnTablet('admin', settings, fake);
  const section = await screen.findByRole('region', { name: SECTION });
  const save = await within(section).findByRole('button', { name: 'Salva' });
  return { ...view, section, save };
}

/** A promise the test settles by hand, to observe the saving state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('LETTORE CARD section', () => {
  it('is not on a phone, even for an administrator', async () => {
    renderApp('/impostazioni', signedInFake());
    await screen.findByRole('region', { name: 'PUNTI E CONTROLLI' });
    expect(screen.queryByRole('region', { name: SECTION })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('is not on the tablet with an operator at the till', async () => {
    openOnTablet('operator');
    await screen.findByRole('region', { name: 'PUNTI' });
    expect(screen.queryByRole('region', { name: SECTION })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('offers the four formats with the current one chosen', async () => {
    const settings = createFakeSettingsService({
      settings: { ...defaultSettings, usbUidFormat: 'dec-reversed' },
    });
    const { section } = await openSection(settings);
    expect(within(section).getByRole('heading', { level: 2, name: SECTION })).toBeInTheDocument();
    const group = within(section).getByRole('radiogroup', { name: 'Formato del lettore USB' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(OPTIONS.map(([label]) => label));
    expect(within(group).getByRole('radio', { name: 'Decimale, byte invertiti' })).toBeChecked();
    expect(within(section).getByText(/Vale dalla lettura successiva\./)).toBeInTheDocument();
  });

  it.each(OPTIONS)('saves "%s" without touching ratio and threshold', async (label, format) => {
    const settings = createFakeSettingsService({
      settings: { ...defaultSettings, usbUidFormat: format === 'hex' ? 'dec' : 'hex' },
    });
    const { section, save } = await openSection(settings);
    // Another administrator changed ratio and threshold after this page was loaded.
    settings.changeElsewhere({ centsPerPoint: 250, confirmThresholdCents: 20000 });

    await userEvent.click(within(section).getByRole('radio', { name: label }));
    await userEvent.click(save);

    expect(await within(section).findByText('Formato salvato.')).toBeInTheDocument();
    expect(settings.service.update).toHaveBeenCalledExactlyOnceWith({
      centsPerPoint: 250,
      confirmThresholdCents: 20000,
      usbUidFormat: format,
    });
    expect(settings.current()).toMatchObject({
      centsPerPoint: 250,
      confirmThresholdCents: 20000,
      usbUidFormat: format,
    });
    expect(within(section).getByRole('radio', { name: label })).toBeChecked();
  });

  it('sends one request for two taps on Salva', async () => {
    const settings = createFakeSettingsService();
    const held = deferred<UpdateSettingsResult>();
    settings.service.update.mockReturnValueOnce(held.promise);
    const { section, save } = await openSection(settings);
    await userEvent.click(within(section).getByRole('radio', { name: 'Decimale' }));
    await userEvent.click(save);
    await userEvent.click(save);

    await act(async () => {
      held.resolve({ status: 'ok', settings: { ...defaultSettings, usbUidFormat: 'dec' } });
      await Promise.resolve();
    });
    expect(await within(section).findByText('Formato salvato.')).toBeInTheDocument();
    expect(settings.service.update).toHaveBeenCalledOnce();
  });

  it('keeps the chosen format when the network fails, and a new Salva then succeeds', async () => {
    const settings = createFakeSettingsService({ updateResults: ['network', 'ok'] });
    const { section, save } = await openSection(settings);
    await userEvent.click(within(section).getByRole('radio', { name: 'Decimale' }));
    await userEvent.click(save);

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Formato non salvato: controlla la connessione e riprova.',
    );
    expect(within(section).getByRole('radio', { name: 'Decimale' })).toBeChecked();
    expect(settings.current().usbUidFormat).toBe('hex');

    await userEvent.click(save);
    expect(await within(section).findByText('Formato salvato.')).toBeInTheDocument();
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument();
    expect(settings.current().usbUidFormat).toBe('dec');
  });

  it('sends nothing when ratio and threshold cannot be read again', async () => {
    const settings = createFakeSettingsService({ loadResults: ['ok', 'network'] });
    const { section, save } = await openSection(settings);
    await userEvent.click(within(section).getByRole('radio', { name: 'Decimale' }));
    await userEvent.click(save);

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Formato non salvato: controlla la connessione e riprova.',
    );
    expect(settings.service.update).not.toHaveBeenCalled();
  });

  it('forbidden: shows the message, disables Salva and reports it to AuthProvider', async () => {
    const fake = signedInFake();
    const settings = createFakeSettingsService({ updateResults: ['forbidden'] });
    const { section, save } = await openSection(settings, fake);
    const checksBefore = fake.service.loadIdentity.mock.calls.length;
    await userEvent.click(within(section).getByRole('radio', { name: 'Decimale' }));
    await userEvent.click(save);

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Solo un amministratore può cambiare il formato del lettore.',
    );
    expect(save).toBeDisabled();
    await waitFor(() =>
      expect(fake.service.loadIdentity.mock.calls.length).toBeGreaterThan(checksBefore),
    );
    expect(settings.current().usbUidFormat).toBe('hex');
  });

  it('a new choice after a save hides "Formato salvato."', async () => {
    const { section, save } = await openSection();
    await userEvent.click(within(section).getByRole('radio', { name: 'Decimale' }));
    await userEvent.click(save);
    expect(await within(section).findByText('Formato salvato.')).toBeInTheDocument();

    await userEvent.click(within(section).getByRole('radio', { name: 'Esadecimale' }));
    expect(within(section).queryByText('Formato salvato.')).not.toBeInTheDocument();
  });
});
