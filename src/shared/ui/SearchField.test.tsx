import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchField } from './SearchField';

describe('SearchField', () => {
  it('is a search box labelled by its visible label', () => {
    render(<SearchField label="Cerca per nome o email" value="" onChange={() => {}} />);
    expect(screen.getByRole('searchbox', { name: 'Cerca per nome o email' })).toBeInTheDocument();
  });

  it('shows the clear button only when there is text', () => {
    const { rerender } = render(<SearchField label="Cerca" value="" onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Cancella la ricerca' })).not.toBeInTheDocument();
    rerender(<SearchField label="Cerca" value="Rossi" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cancella la ricerca' })).toBeInTheDocument();
  });

  it('clears the text and puts focus back in the box', async () => {
    const onChange = vi.fn<(value: string) => void>();
    render(<SearchField label="Cerca" value="Rossi" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancella la ricerca' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('gives its input to a ref, and the clear button still focuses it', async () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn<(value: string) => void>();
    render(<SearchField ref={ref} label="Cerca" value="Rossi" onChange={onChange} />);
    expect(ref.current).toBe(screen.getByRole('searchbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancella la ricerca' }));
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });
});
