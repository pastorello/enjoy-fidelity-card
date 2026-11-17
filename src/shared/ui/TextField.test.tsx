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

  it('renders the stacked layout by default, without a suffix', () => {
    const { container } = render(<TextField label="Nome" value="" onChange={() => {}} />);
    expect(container.firstElementChild).not.toHaveAttribute('data-layout');
    expect(screen.queryByText('€')).not.toBeInTheDocument();
  });

  describe('inline layout', () => {
    it('keeps the label associated and shows the suffix', () => {
      const { container } = render(
        <TextField
          label="1 punto ogni"
          value="1,00"
          onChange={() => {}}
          layout="inline"
          suffix="€"
          inputMode="decimal"
        />,
      );
      const input = screen.getByRole('textbox', { name: '1 punto ogni' });
      expect(input).toHaveValue('1,00');
      expect(input).toHaveAttribute('inputmode', 'decimal');
      expect(screen.getByText('€')).toBeVisible();
      expect(container.firstElementChild).toHaveAttribute('data-layout', 'inline');
    });

    it('keeps the suffix out of the accessible name', () => {
      render(
        <TextField
          label="Chiedi conferma sopra"
          value="150,00"
          onChange={() => {}}
          layout="inline"
          suffix="€"
        />,
      );
      expect(screen.getByRole('textbox', { name: 'Chiedi conferma sopra' })).toBeInTheDocument();
    });

    it('links an error to the input and marks it invalid', () => {
      render(
        <TextField
          label="1 punto ogni"
          value="0"
          onChange={() => {}}
          layout="inline"
          suffix="€"
          error="Scrivi solo cifre e la virgola, per esempio 1,50."
        />,
      );
      const input = screen.getByRole('textbox', { name: '1 punto ogni' });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription(
        'Scrivi solo cifre e la virgola, per esempio 1,50.',
      );
    });

    it('links a hint to the input', () => {
      render(
        <TextField
          label="1 punto ogni"
          value="1,00"
          onChange={() => {}}
          layout="inline"
          hint="Facoltativo"
        />,
      );
      const input = screen.getByRole('textbox', { name: '1 punto ogni' });
      expect(input).not.toHaveAttribute('aria-invalid');
      expect(input).toHaveAccessibleDescription('Facoltativo');
    });

    it('reports typed text', async () => {
      const onChange = vi.fn<(value: string) => void>();
      render(
        <TextField label="1 punto ogni" value="" onChange={onChange} layout="inline" suffix="€" />,
      );
      await userEvent.type(screen.getByRole('textbox'), '2');
      expect(onChange).toHaveBeenCalledWith('2');
    });
  });
});
