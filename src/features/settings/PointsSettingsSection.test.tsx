import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeOperator } from '../../test/fakeAuthService';
import { createFakeSettingsService, defaultSettings } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import type { UpdateSettingsResult } from './types';

const operator = () =>
  signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role: 'operator' } });

const finalNote =
  'Operatori, premi, esportazioni e annullamenti dei movimenti li gestiscono gli amministratori.';

/** formatCents puts a non-breaking space before "€": compare with plain spaces. */
function normalized(element: HTMLElement) {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** A promise the test settles by hand, to observe the loading and saving states. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('points section for operators', () => {
  it('shows the ratio read-only, without fields, Salva or threshold', async () => {
    renderApp('/impostazioni', operator());
    const section = await screen.findByRole('region', { name: 'PUNTI' });
    expect(within(section).getByRole('heading', { level: 2, name: 'PUNTI' })).toBeInTheDocument();
    expect(await within(section).findByText(/1 punto ogni/)).toBeInTheDocument();
    expect(normalized(within(section).getByText(/1 punto ogni/))).toBe(
      '1 punto ogni 1,00 € di spesa',
    );
    expect(
      within(section).getByText('Il rapporto lo decide un amministratore.'),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salva' })).not.toBeInTheDocument();
    expect(screen.queryByText(/150,00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/conferma/i)).not.toBeInTheDocument();
  });

  it('formats the configured ratio', async () => {
    const settings = createFakeSettingsService({
      settings: { ...defaultSettings, centsPerPoint: 250 },
    });
    renderApp('/impostazioni', operator(), settings);
    const section = await screen.findByRole('region', { name: 'PUNTI' });
    expect(normalized(await within(section).findByText(/1 punto ogni/))).toBe(
      '1 punto ogni 2,50 € di spesa',
    );
  });

  it('ends the page with the note about what administrators manage', async () => {
    renderApp('/impostazioni', operator());
    const note = await screen.findByText(finalNote);
    expect(note.parentElement).toBe(screen.getByRole('main'));
    expect(note.nextElementSibling).toBeNull();
  });

  it('shows a loading state inside the section, the rest of the page stays usable', async () => {
    const settings = createFakeSettingsService();
    settings.service.load.mockReturnValueOnce(new Promise(() => {}));
    renderApp('/impostazioni', operator(), settings);
    const section = await screen.findByRole('region', { name: 'PUNTI' });
    expect(within(section).getByRole('status')).toHaveTextContent('Caricamento…');
    expect(within(section).queryByText(/1 punto ogni/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esci' })).toBeEnabled();
    expect(screen.getByRole('link', { name: /Cambia password/ })).toBeInTheDocument();
  });

  it('shows "Impostazioni non caricate" and "Riprova" loads again', async () => {
    const settings = createFakeSettingsService({ loadResults: ['network', 'ok'] });
    renderApp('/impostazioni', operator(), settings);
    const section = await screen.findByRole('region', { name: 'PUNTI' });
    const alert = await within(section).findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Impostazioni non caricate' })).toBeVisible();
    expect(within(section).queryByText(/1 punto ogni/)).not.toBeInTheDocument();
    expect(settings.service.load).toHaveBeenCalledTimes(1);

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(settings.service.load).toHaveBeenCalledTimes(2);
    expect(normalized(await within(section).findByText(/1 punto ogni/))).toBe(
      '1 punto ogni 1,00 € di spesa',
    );
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps focus inside the section after Riprova, while loading and on a new error', async () => {
    const settings = createFakeSettingsService({ loadResults: ['network'] });
    renderApp('/impostazioni', operator(), settings);
    const section = await screen.findByRole('region', { name: 'PUNTI' });
    const alert = await within(section).findByRole('alert');
    const heading = within(section).getByRole('heading', { level: 2, name: 'PUNTI' });
    const pending = deferred<never>();
    settings.service.load.mockReturnValueOnce(pending.promise);

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(within(section).getByRole('status')).toHaveTextContent('Caricamento…');
    expect(heading).toHaveFocus();

    await act(async () => pending.reject(new Error('offline')));
    expect(await within(section).findByRole('alert')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(section.contains(document.activeElement)).toBe(true);
  });

  it('shows only the error state, without data, when no row is visible', async () => {
    const settings = createFakeSettingsService({ loadResults: ['not-found'] });
    renderApp('/impostazioni', operator(), settings);
    const section = await screen.findByRole('region', { name: 'PUNTI' });
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Impostazioni non caricate',
    );
    expect(within(section).queryByText(/1 punto ogni/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/Il rapporto lo decide/)).not.toBeInTheDocument();
  });

  it('is not shown to administrators, nor is the final note', async () => {
    renderApp('/impostazioni', signedInFake());
    await screen.findByRole('region', { name: 'PUNTI E CONTROLLI' });
    expect(screen.queryByRole('region', { name: 'PUNTI' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Il rapporto lo decide/)).not.toBeInTheDocument();
    expect(screen.queryByText(finalNote)).not.toBeInTheDocument();
  });
});

const helpText =
  'Il rapporto vale per le spese registrate da ora in poi. La conferma evita errori di battitura, come 1250 al posto di 12,50.';

async function openAdminSection(settings = createFakeSettingsService(), auth = signedInFake()) {
  const rendered = renderApp('/impostazioni', auth, settings);
  const section = await screen.findByRole('region', { name: 'PUNTI E CONTROLLI' });
  const ratio = await within(section).findByRole('textbox', { name: '1 punto ogni' });
  const threshold = within(section).getByRole('textbox', { name: 'Chiedi conferma sopra' });
  const save = within(section).getByRole('button', { name: 'Salva' });
  return { ...rendered, section, ratio, threshold, save };
}

async function replace(input: HTMLElement, text: string) {
  await userEvent.clear(input);
  if (text !== '') await userEvent.type(input, text);
}

describe('points and controls section for administrators', () => {
  it('shows both fields prefilled, the help text and Salva', async () => {
    const { section, ratio, threshold } = await openAdminSection();
    expect(
      within(section).getByRole('heading', { level: 2, name: 'PUNTI E CONTROLLI' }),
    ).toBeInTheDocument();
    expect(ratio).toHaveValue('1,00');
    expect(threshold).toHaveValue('150,00');
    for (const input of [ratio, threshold]) {
      expect(input).toHaveAttribute('inputmode', 'decimal');
      expect(input).not.toHaveAttribute('readonly');
    }
    expect(within(section).getAllByText('€')).toHaveLength(2);
    expect(ratio).toHaveAccessibleDescription('€');
    expect(threshold).toHaveAccessibleDescription('€');
    expect(within(section).getByText(helpText)).toBeInTheDocument();
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saves both values together, confirms and shows the server values reformatted', async () => {
    const { section, ratio, threshold, save, settings } = await openAdminSection();
    await replace(ratio, '2');
    await replace(threshold, '200');
    await userEvent.click(save);

    expect(settings.service.update).toHaveBeenCalledTimes(1);
    expect(settings.service.update).toHaveBeenCalledWith({
      centsPerPoint: 200,
      confirmThresholdCents: 20000,
    });
    const live = within(section).getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(live).toHaveTextContent('Impostazioni salvate.'));
    expect(ratio).toHaveValue('2,00');
    expect(threshold).toHaveValue('200,00');
  });

  it('keeps the live region in place before saving, so the message is announced', async () => {
    const { section } = await openAdminSection();
    const live = within(section).getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toBeEmptyDOMElement();
  });

  it('marks Salva busy and the fields read-only while saving; a double tap saves once', async () => {
    const pending = deferred<UpdateSettingsResult>();
    const settings = createFakeSettingsService();
    settings.service.update.mockImplementationOnce(() => pending.promise);
    const { section, ratio, threshold, save } = await openAdminSection(settings);

    await replace(ratio, '2');
    await userEvent.dblClick(save);
    await userEvent.click(save);

    expect(settings.service.update).toHaveBeenCalledTimes(1);
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(ratio).toHaveAttribute('readonly');
    expect(threshold).toHaveAttribute('readonly');

    pending.resolve({
      status: 'ok',
      settings: { ...defaultSettings, centsPerPoint: 200, updatedAt: '2026-11-17T10:00:00.000Z' },
    });
    expect(await within(section).findByText('Impostazioni salvate.')).toBeInTheDocument();
    expect(save).not.toHaveAttribute('aria-busy');
    expect(ratio).not.toHaveAttribute('readonly');
    expect(ratio).toHaveValue('2,00');
  });

  it('saves once when two submits arrive before the busy state renders', async () => {
    const pending = deferred<UpdateSettingsResult>();
    const settings = createFakeSettingsService();
    settings.service.update.mockImplementationOnce(() => pending.promise);
    const { section, save } = await openAdminSection(settings);
    const form = save.closest('form')!;

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(settings.service.update).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ status: 'ok', settings: { ...defaultSettings } }));
    expect(await within(section).findAllByText('Impostazioni salvate.')).toHaveLength(1);
    expect(settings.service.update).toHaveBeenCalledTimes(1);
  });

  it('removes the confirmation as soon as a field changes again', async () => {
    const { section, ratio, save } = await openAdminSection();
    await userEvent.click(save);
    expect(await within(section).findByText('Impostazioni salvate.')).toBeInTheDocument();
    await userEvent.type(ratio, '5');
    expect(within(section).queryByText('Impostazioni salvate.')).not.toBeInTheDocument();
  });

  it.each([
    ['0', 'Deve essere maggiore di 0,00 €.'],
    ['', 'Inserisci un importo, per esempio 1,00.'],
    ['abc', 'Scrivi solo cifre e la virgola, per esempio 1,50.'],
    ['1,555', 'Usa al massimo due decimali, per esempio 1,50.'],
    ['1.250', 'Usa al massimo due decimali, per esempio 1,50.'],
    ['100,01', 'Al massimo 100,00 € per punto.'],
  ])('ratio "%s" → "%s", focus on the field, nothing sent', async (text, message) => {
    const { ratio, threshold, save, settings } = await openAdminSection();
    await replace(ratio, text);
    await userEvent.click(save);

    expect(ratio).toHaveAttribute('aria-invalid', 'true');
    expect(ratio).toHaveAccessibleDescription(`€ ${message}`);
    expect(ratio).toHaveFocus();
    expect(threshold).not.toHaveAttribute('aria-invalid');
    expect(settings.service.update).not.toHaveBeenCalled();
  });

  it.each([
    ['0', 'Deve essere maggiore di 0,00 €.'],
    ['', 'Inserisci un importo, per esempio 1,00.'],
    ['abc', 'Scrivi solo cifre e la virgola, per esempio 1,50.'],
    ['1,555', 'Usa al massimo due decimali, per esempio 1,50.'],
    ['1.250', 'Usa al massimo due decimali, per esempio 1,50.'],
    ['10000,01', 'Al massimo 10.000,00 €.'],
  ])('threshold "%s" → "%s", focus on the field, nothing sent', async (text, message) => {
    const { ratio, threshold, save, settings } = await openAdminSection();
    await replace(threshold, text);
    await userEvent.click(save);

    expect(threshold).toHaveAttribute('aria-invalid', 'true');
    expect(threshold).toHaveAccessibleDescription(`€ ${message}`);
    expect(threshold).toHaveFocus();
    expect(ratio).not.toHaveAttribute('aria-invalid');
    expect(settings.service.update).not.toHaveBeenCalled();
  });

  it('accepts the ratio and threshold at their maximum', async () => {
    const { ratio, threshold, save, settings } = await openAdminSection();
    await replace(ratio, '100,00');
    await replace(threshold, '10000,00');
    await userEvent.click(save);
    expect(settings.service.update).toHaveBeenCalledWith({
      centsPerPoint: 10000,
      confirmThresholdCents: 1000000,
    });
  });

  it('shows both errors and focuses the first invalid field', async () => {
    const { ratio, threshold, save, settings } = await openAdminSection();
    await replace(ratio, '0');
    await replace(threshold, 'abc');
    await userEvent.click(save);
    expect(ratio).toHaveAccessibleDescription('€ Deve essere maggiore di 0,00 €.');
    expect(threshold).toHaveAccessibleDescription(
      '€ Scrivi solo cifre e la virgola, per esempio 1,50.',
    );
    expect(ratio).toHaveFocus();
    expect(settings.service.update).not.toHaveBeenCalled();
  });

  it('clears the errors once the values are valid and saved', async () => {
    const { section, ratio, save, settings } = await openAdminSection();
    await replace(ratio, '0');
    await userEvent.click(save);
    expect(ratio).toHaveAttribute('aria-invalid', 'true');
    await replace(ratio, '3');
    await userEvent.click(save);
    expect(settings.service.update).toHaveBeenCalledTimes(1);
    expect(await within(section).findByText('Impostazioni salvate.')).toBeInTheDocument();
    expect(ratio).not.toHaveAttribute('aria-invalid');
    expect(ratio).toHaveValue('3,00');
  });

  it.each([['1.50'], ['1,5']])('reads "%s" as 1,50 €', async (text) => {
    const { ratio, save, settings } = await openAdminSection();
    await replace(ratio, text);
    await userEvent.click(save);
    expect(settings.service.update).toHaveBeenCalledWith({
      centsPerPoint: 150,
      confirmThresholdCents: 15000,
    });
    await waitFor(() => expect(ratio).toHaveValue('1,50'));
  });

  it('shows a loading state inside the section, the rest of the page stays usable', async () => {
    const settings = createFakeSettingsService();
    settings.service.load.mockReturnValueOnce(new Promise(() => {}));
    renderApp('/impostazioni', signedInFake(), settings);
    const section = await screen.findByRole('region', { name: 'PUNTI E CONTROLLI' });
    expect(within(section).getByRole('status')).toHaveTextContent('Caricamento…');
    expect(within(section).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Salva' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esci' })).toBeEnabled();
    expect(screen.getByRole('link', { name: /Cambia password/ })).toBeInTheDocument();
  });

  it('keeps focus inside the section after Riprova, while loading and on a new error', async () => {
    const settings = createFakeSettingsService({ loadResults: ['network'] });
    renderApp('/impostazioni', signedInFake(), settings);
    const section = await screen.findByRole('region', { name: 'PUNTI E CONTROLLI' });
    const alert = await within(section).findByRole('alert');
    const heading = within(section).getByRole('heading', { level: 2, name: 'PUNTI E CONTROLLI' });
    const pending = deferred<never>();
    settings.service.load.mockReturnValueOnce(pending.promise);

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(within(section).getByRole('status')).toHaveTextContent('Caricamento…');
    expect(heading).toHaveFocus();

    await act(async () => pending.reject(new Error('offline')));
    expect(await within(section).findByRole('alert')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(section.contains(document.activeElement)).toBe(true);
  });

  it('shows "Impostazioni non caricate" with Riprova, which loads again', async () => {
    const settings = createFakeSettingsService({ loadResults: ['network', 'ok'] });
    renderApp('/impostazioni', signedInFake(), settings);
    const section = await screen.findByRole('region', { name: 'PUNTI E CONTROLLI' });
    const alert = await within(section).findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Impostazioni non caricate' })).toBeVisible();
    expect(within(section).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Salva' })).not.toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(settings.service.load).toHaveBeenCalledTimes(2);
    expect(await within(section).findByRole('textbox', { name: '1 punto ogni' })).toHaveValue(
      '1,00',
    );
  });
});

const networkMessage = 'Impostazioni non salvate: controlla la connessione e riprova.';
const forbiddenMessage = 'Solo un amministratore può cambiare queste impostazioni.';
const reloadMessage = 'Impostazioni non salvate. Ricarica la pagina e riprova.';

describe('save errors and reloads for administrators', () => {
  it('keeps the typed values when the network fails, and a new Salva then succeeds', async () => {
    const settings = createFakeSettingsService({ updateResults: ['network', 'ok'] });
    const { section, ratio, threshold, save } = await openAdminSection(settings);
    await replace(ratio, '2');
    await replace(threshold, '200');
    await userEvent.click(save);

    expect(await within(section).findByRole('alert')).toHaveTextContent(networkMessage);
    expect(ratio).toHaveValue('2');
    expect(threshold).toHaveValue('200');
    expect(within(section).queryByText('Impostazioni salvate.')).not.toBeInTheDocument();
    expect(save).toBeEnabled();

    await userEvent.click(save);
    expect(settings.service.update).toHaveBeenCalledTimes(2);
    expect(settings.service.update).toHaveBeenLastCalledWith({
      centsPerPoint: 200,
      confirmThresholdCents: 20000,
    });
    expect(await within(section).findByText('Impostazioni salvate.')).toBeInTheDocument();
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument();
    expect(ratio).toHaveValue('2,00');
    expect(threshold).toHaveValue('200,00');
  });

  it.each([['invalid' as const], ['unknown' as const]])(
    '"%s" asks to reload the page and keeps the typed values',
    async (status) => {
      const settings = createFakeSettingsService({ updateResults: [status] });
      const { section, ratio, threshold, save } = await openAdminSection(settings);
      await replace(ratio, '2');
      await replace(threshold, '200');
      await userEvent.click(save);

      expect(await within(section).findByRole('alert')).toHaveTextContent(reloadMessage);
      expect(ratio).toHaveValue('2');
      expect(threshold).toHaveValue('200');
      expect(within(section).queryByText('Impostazioni salvate.')).not.toBeInTheDocument();
    },
  );

  it('treats a save that throws like an unexpected error', async () => {
    const settings = createFakeSettingsService();
    settings.service.update.mockRejectedValueOnce(new Error('boom'));
    const { section, ratio, save } = await openAdminSection(settings);
    await replace(ratio, '2');
    await userEvent.click(save);
    expect(await within(section).findByRole('alert')).toHaveTextContent(reloadMessage);
    expect(ratio).toHaveValue('2');
  });

  it('forbidden: shows the message, disables Salva and reports it to AuthProvider', async () => {
    const auth = signedInFake();
    const settings = createFakeSettingsService({ updateResults: ['forbidden', 'ok'] });
    const { section, ratio, save } = await openAdminSection(settings, auth);
    const checksBefore = auth.service.loadOperator.mock.calls.length;
    await replace(ratio, '2');
    await userEvent.click(save);

    expect(await within(section).findByRole('alert')).toHaveTextContent(forbiddenMessage);
    expect(save).toBeDisabled();
    expect(ratio).toHaveValue('2');
    await waitFor(() => expect(auth.service.loadOperator.mock.calls.length).toBe(checksBefore + 1));

    // Still disabled after the re-check confirms the admin role, and after editing again.
    await userEvent.type(ratio, '5');
    expect(save).toBeDisabled();
    fireEvent.submit(save.closest('form')!);
    expect(settings.service.update).toHaveBeenCalledTimes(1);
    expect(within(section).getByRole('alert')).toHaveTextContent(forbiddenMessage);
  });

  it('forbidden after the role became operator: the section switches to "PUNTI"', async () => {
    const auth = signedInFake();
    const settings = createFakeSettingsService({ updateResults: ['forbidden'] });
    const { ratio, save } = await openAdminSection(settings, auth);
    auth.setProfile({ ...fakeOperator, role: 'operator' });
    await replace(ratio, '2');
    await userEvent.click(save);

    const section = await screen.findByRole('region', { name: 'PUNTI' });
    expect(normalized(within(section).getByText(/1 punto ogni/))).toBe(
      '1 punto ogni 1,00 € di spesa',
    );
    expect(screen.queryByRole('region', { name: 'PUNTI E CONTROLLI' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('forbidden after the profile was removed: back to /accedi', async () => {
    const auth = signedInFake();
    const settings = createFakeSettingsService({ updateResults: ['forbidden'] });
    const { router, save } = await openAdminSection(settings, auth);
    auth.removeProfile();
    await userEvent.click(save);
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });

  it('a reload keeps the edited field and refreshes the untouched one', async () => {
    const { ratio, threshold, settings } = await openAdminSection();
    await replace(ratio, '2');
    settings.changeElsewhere({ centsPerPoint: 300, confirmThresholdCents: 25000 });

    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });

    await waitFor(() => expect(threshold).toHaveValue('250,00'));
    expect(settings.service.load).toHaveBeenCalledTimes(2);
    expect(ratio).toHaveValue('2');
  });

  it('a reload refreshes both fields when neither was edited', async () => {
    const { ratio, threshold, settings } = await openAdminSection();
    settings.changeElsewhere({ centsPerPoint: 300, confirmThresholdCents: 25000 });
    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });
    await waitFor(() => expect(ratio).toHaveValue('3,00'));
    expect(threshold).toHaveValue('250,00');
  });

  it('a reload after a failed save keeps the typed values', async () => {
    const settings = createFakeSettingsService({ updateResults: ['network'] });
    const { section, ratio, threshold, save } = await openAdminSection(settings);
    await replace(ratio, '2');
    await userEvent.click(save);
    await within(section).findByRole('alert');
    settings.changeElsewhere({ centsPerPoint: 300, confirmThresholdCents: 25000 });

    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });

    await waitFor(() => expect(threshold).toHaveValue('250,00'));
    expect(ratio).toHaveValue('2');
  });
});
