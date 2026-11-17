import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createFakeSettingsService, defaultSettings } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';

const operator = () =>
  signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role: 'operator' } });

const finalNote =
  'Operatori, premi, esportazioni e annullamenti dei movimenti li gestiscono gli amministratori.';

/** formatCents puts a non-breaking space before "€": compare with plain spaces. */
function normalized(element: HTMLElement) {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
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
    await screen.findByRole('region', { name: 'ACCOUNT' });
    expect(screen.queryByRole('region', { name: 'PUNTI' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Il rapporto lo decide/)).not.toBeInTheDocument();
    expect(screen.queryByText(finalNote)).not.toBeInTheDocument();
  });
});
