import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';

function Harness({ focusSave = false }: { focusSave?: boolean }) {
  const [open, setOpen] = useState(false);
  const saveRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Maria Rossi
      </Button>
      <Dialog
        open={open}
        title="Maria Rossi"
        initialFocusRef={focusSave ? saveRef : undefined}
        onClose={() => setOpen(false)}
      >
        <p>maria@example.com · Attivo</p>
        <Button ref={saveRef} block>
          Salva ruolo
        </Button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('is closed until opened', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a dialog named by its title, with its content and a "Chiudi" action', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Maria Rossi' }));
    const dialog = screen.getByRole('dialog', { name: 'Maria Rossi' });
    expect(dialog).toHaveTextContent('maria@example.com · Attivo');
    expect(screen.getByRole('heading', { level: 2, name: 'Maria Rossi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chiudi' })).toBeInTheDocument();
  });

  it('is described by its description when one is given', () => {
    render(
      <Dialog
        open
        title="Cancellare i dati?"
        description="Non si può tornare indietro."
        onClose={() => {}}
      >
        {null}
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Cancellare i dati?' })).toHaveAccessibleDescription(
      'Non si può tornare indietro.',
    );
  });

  it('starts on "Chiudi" by default', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Maria Rossi' }));
    expect(screen.getByRole('button', { name: 'Chiudi' })).toHaveFocus();
  });

  it('starts on the element it is given', async () => {
    render(<Harness focusSave />);
    await userEvent.click(screen.getByRole('button', { name: 'Maria Rossi' }));
    expect(screen.getByRole('button', { name: 'Salva ruolo' })).toHaveFocus();
  });

  it('Esc (the dialog cancel event) closes it and returns focus to the opener', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Maria Rossi' });
    await userEvent.click(opener);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('"Chiudi" closes it and returns focus to the opener', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Maria Rossi' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('names its close action as asked', () => {
    render(
      <Dialog open title="Annullare?" closeLabel="Lascia com’è" onClose={() => {}}>
        {null}
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Lascia com’è' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chiudi' })).not.toBeInTheDocument();
  });

  it('hands its close action to closeRef, so a step of the dialog can move the focus there', () => {
    const closeRef = { current: null as HTMLButtonElement | null };
    render(
      <Dialog
        open
        title="Annullare?"
        closeLabel="Lascia com’è"
        closeRef={closeRef}
        onClose={() => {}}
      >
        {null}
      </Dialog>,
    );
    expect(closeRef.current).toBe(screen.getByRole('button', { name: 'Lascia com’è' }));
    // It still starts on the close action by default.
    expect(closeRef.current).toHaveFocus();
  });
});
