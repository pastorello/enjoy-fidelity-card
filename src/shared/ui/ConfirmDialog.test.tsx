import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';

function noop() {}

function Harness({ onConfirm = noop }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger-secondary" onClick={() => setOpen(true)}>
        Annulla
      </Button>
      <ConfirmDialog
        open={open}
        tone="danger"
        title="Annullare la spesa di 12,50 €?"
        description="Si registra una correzione di −12 punti."
        confirmLabel="Annulla la spesa"
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('is closed until opened', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a dialog named by its question, described by the consequence', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    const dialog = screen.getByRole('dialog', { name: 'Annullare la spesa di 12,50 €?' });
    expect(dialog).toHaveAccessibleDescription('Si registra una correzione di −12 punti.');
  });

  it('puts focus on the safe choice for a dangerous action', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByRole('button', { name: 'Lascia com’è' })).toHaveFocus();
  });

  it('confirms with the button that repeats the action', async () => {
    const onConfirm = vi.fn<() => void>();
    render(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    await userEvent.click(screen.getByRole('button', { name: 'Annulla la spesa' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Esc (the dialog cancel event) cancels and returns focus to the opener', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Annulla' });
    await userEvent.click(opener);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('"Lascia com’è" cancels and returns focus to the opener', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Annulla' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Lascia com’è' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
