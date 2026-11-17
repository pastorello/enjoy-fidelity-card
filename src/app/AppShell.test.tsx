import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Button } from '../shared/ui/Button';
import { AppShell } from './AppShell';

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

  it('puts actions in a footer below the content', () => {
    renderShell(<AppShell actions={<Button>Conferma</Button>}>x</AppShell>);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('button', { name: 'Conferma' })).toBeInTheDocument();
  });

  it('has no footer without actions', () => {
    renderShell(<AppShell>x</AppShell>);
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });
});
