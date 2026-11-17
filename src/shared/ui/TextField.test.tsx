import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TextField } from './TextField';

describe('TextField', () => {
  it('is labelled by its visible label', () => {
    render(<TextField label="Nome e cognome" value="" onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Nome e cognome' })).toBeInTheDocument();
  });

  it('reports typed text', async () => {
    const onChange = vi.fn<(value: string) => void>();
    render(<TextField label="Nome" value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'M');
    expect(onChange).toHaveBeenCalledWith('M');
  });

  it('links an error to the input and marks it invalid', () => {
    render(
      <TextField
        label="Nome"
        value="Maria Rossi"
        onChange={() => {}}
        error="Esiste già Maria Rossi"
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Nome' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Esiste già Maria Rossi');
  });

  it('links a hint to the input when there is no error', () => {
    render(<TextField label="Telefono" value="" onChange={() => {}} hint="Facoltativo" />);
    const input = screen.getByRole('textbox', { name: 'Telefono' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription('Facoltativo');
  });

  it('passes input attributes through', () => {
    render(
      <TextField
        label="Telefono"
        value=""
        onChange={() => {}}
        type="tel"
        autoComplete="off"
        required
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Telefono' });
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toBeRequired();
  });
});
