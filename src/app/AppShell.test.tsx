import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../shared/ui/Button';
import { AppShell } from './AppShell';

/** jsdom has no layout: a title longer than `fits` characters overflows its two lines. */
function fakeLayout(fits: number) {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(50);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return (this.textContent ?? '').length > fits ? 125 : 50;
  });
}

function renderShell(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('AppShell', () => {
  it('home variant: green header whose heading is the Enjoy logo', () => {
    renderShell(<AppShell>contenuto</AppShell>);
    const banner = screen.getByRole('banner');
    const heading = within(banner).getByRole('heading', { level: 1, name: 'Enjoy Card' });
    expect(within(heading).getByRole('img', { name: 'Enjoy Card' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('contenuto');
  });

  it('shows the account button when an account is given', () => {
    renderShell(<AppShell account={{ name: 'Giulia', to: '/impostazioni' }}>x</AppShell>);
    const link = screen.getByRole('link', { name: 'Account e impostazioni: Giulia' });
    expect(link).toHaveAttribute('href', '/impostazioni');
    expect(link).toHaveTextContent('G');
  });

  it('screen variant: back link and the screen title as heading', () => {
    renderShell(
      <AppShell title="Registra spesa" backTo="/">
        x
      </AppShell>,
    );
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('heading', { level: 1, name: 'Registra spesa' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Enjoy Card' })).not.toBeInTheDocument();
  });

  it('header action: an icon link named by its label, to the right of the title', () => {
    renderShell(
      <AppShell
        title="Maria Rossi"
        backTo="/"
        headerAction={{ label: 'Modifica cliente', icon: 'pencil', to: '/clienti/1/modifica' }}
      >
        x
      </AppShell>,
    );
    const banner = screen.getByRole('banner');
    const action = within(banner).getByRole('link', { name: 'Modifica cliente' });
    expect(action).toHaveAttribute('href', '/clienti/1/modifica');
    // Same 48 px icon button as "Indietro" (var(--touch-target)).
    expect(action).toHaveClass(within(banner).getByRole('link', { name: 'Indietro' }).className);
    const heading = within(banner).getByRole('heading', { level: 1, name: 'Maria Rossi' });
    expect(heading.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no header action unless given', () => {
    renderShell(
      <AppShell title="Registra spesa" backTo="/">
        x
      </AppShell>,
    );
    expect(within(screen.getByRole('banner')).getAllByRole('link')).toHaveLength(1);
  });

  it('puts actions in a footer below the content', () => {
    renderShell(<AppShell actions={<Button>Conferma</Button>}>x</AppShell>);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('button', { name: 'Conferma' })).toBeInTheDocument();
  });

  it('has no footer without actions', () => {
    renderShell(<AppShell>x</AppShell>);
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });

  it('headingRef: the h1 is given to the ref and can take the focus from script', () => {
    const heading = createRef<HTMLHeadingElement>();
    renderShell(
      <AppShell title="Scheda cliente" backTo="/" headingRef={heading}>
        x
      </AppShell>,
    );
    const h1 = screen.getByRole('heading', { level: 1, name: 'Scheda cliente' });
    expect(heading.current).toBe(h1);
    expect(h1).toHaveAttribute('tabindex', '-1');
    heading.current?.focus();
    expect(h1).toHaveFocus();
  });

  it('without headingRef the h1 is not focusable', () => {
    renderShell(<AppShell title="Scheda cliente">x</AppShell>);
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveAttribute('tabindex');
  });

  describe('repeatCutTitle', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const LONG = 'Maria Giovanna Esposito De Laurentiis Serapo Formia Lungomare Caboto Ventitre';

    it('repeats a title cut by the header in full as the first line of the content', () => {
      fakeLayout(26);
      renderShell(
        <AppShell title={LONG} backTo="/" repeatCutTitle>
          <p>contenuto</p>
        </AppShell>,
      );
      const main = screen.getByRole('main');
      const first = main.firstElementChild;
      expect(first).toHaveTextContent(LONG);
      expect(first).toHaveAttribute('aria-hidden', 'true');
      // Screen readers hear the heading only once.
      expect(screen.getByRole('heading', { level: 1, name: LONG })).toBeInTheDocument();
    });

    it('does not repeat a title that fits', () => {
      fakeLayout(26);
      renderShell(
        <AppShell title="Maria Rossi" backTo="/" repeatCutTitle>
          <p>contenuto</p>
        </AppShell>,
      );
      expect(screen.getByRole('main')).not.toHaveTextContent('Maria Rossi');
    });

    it('without the prop, a cut title is not repeated', () => {
      fakeLayout(26);
      renderShell(
        <AppShell title={LONG} backTo="/">
          <p>contenuto</p>
        </AppShell>,
      );
      expect(screen.getByRole('main')).not.toHaveTextContent(LONG);
    });
  });
});
