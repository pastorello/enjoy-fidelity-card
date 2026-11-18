import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, signedInFake } from '../../test/renderApp';

const operatorSession = () =>
  signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role: 'operator' } });

describe('ESPORTA DATI section of the settings (SPEC-export, criteria 1 and 9)', () => {
  it('offers "Clienti CSV" then "Movimenti CSV" to administrators, with a live region below', async () => {
    renderApp('/impostazioni', signedInFake());
    const section = await screen.findByRole('region', { name: 'ESPORTA DATI' });
    expect(
      within(section).getByRole('heading', { level: 2, name: 'ESPORTA DATI' }),
    ).toBeInTheDocument();
    const buttons = within(section).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Clienti CSV', 'Movimenti CSV']);
    for (const button of buttons) {
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('data-variant', 'secondary');
      // The download icon of the wireframe: its three Lucide strokes.
      const paths = Array.from(button.querySelectorAll('svg path')).map((path) =>
        path.getAttribute('d'),
      );
      expect(paths).toEqual([
        'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
        'm7 10 5 5 5-5',
        'M12 15V3',
      ]);
    }
    // Nothing to announce yet; the region comes after the buttons.
    const status = within(section).getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
    const lastButton = buttons.at(-1);
    expect(lastButton).toBeDefined();
    expect(
      lastButton && lastButton.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('is the last section of the administrator page', async () => {
    renderApp('/impostazioni', signedInFake());
    const section = await screen.findByRole('region', { name: 'ESPORTA DATI' });
    expect(screen.getByRole('main').lastElementChild).toBe(section);
  });

  it('is not shown to operators, who still read the final note', async () => {
    renderApp('/impostazioni', operatorSession());
    await screen.findByRole('region', { name: 'ACCOUNT' });
    expect(screen.queryByRole('region', { name: 'ESPORTA DATI' })).not.toBeInTheDocument();
    expect(screen.queryByText('ESPORTA DATI')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CSV/ })).not.toBeInTheDocument();
    expect(screen.getByText(/li gestiscono gli amministratori\.$/)).toBeInTheDocument();
  });
});
