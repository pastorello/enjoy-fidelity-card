import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AdminsOnly } from './AdminsOnly';

describe('AdminsOnly', () => {
  it('shows the screen title, the lock message and the way back to the settings', () => {
    render(
      <MemoryRouter>
        <AdminsOnly
          title="Operatori"
          description="Gli operatori li gestiscono gli amministratori."
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Operatori' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Solo per gli amministratori' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Gli operatori li gestiscono gli amministratori.')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Torna alle impostazioni' });
    expect(link).toHaveAttribute('href', '/impostazioni');
    expect(link).toHaveAttribute('data-variant', 'secondary');
    // The header's "Indietro" also leads to the settings.
    const back = screen.getByRole('link', { name: 'Indietro' });
    expect(back).toHaveAttribute('href', '/impostazioni');
  });
});
