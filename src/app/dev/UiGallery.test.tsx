import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { UiGallery } from './UiGallery';

// SPEC-customers-v2 point 1: the showcase follows the app, with the email in place of the phone.
describe('UiGallery', () => {
  it('shows the search and the email field of the app, no customer phone', () => {
    render(
      <MemoryRouter>
        <UiGallery />
      </MemoryRouter>,
    );

    const search = screen.getByRole('searchbox', { name: 'Cerca per nome o email' });
    expect(search).toHaveAttribute('placeholder', 'Es. Rossi o rossi@');
    expect(screen.getByRole('textbox', { name: /Email \(facoltativa\)/ })).toHaveAttribute(
      'type',
      'email',
    );

    // The text fields of the showcase: no phone among them.
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
    expect(screen.queryByText(/telefono ·|•••|ultime 4 cifre/i)).not.toBeInTheDocument();
    expect(screen.getByText('Nessun cliente trovato')).toBeVisible();
    expect(screen.getByText('Controlla come è scritto, o cerca con l’email.')).toBeVisible();
  });
});
