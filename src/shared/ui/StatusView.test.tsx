import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusView } from './StatusView';

describe('StatusView', () => {
  it('loading: announced politely as a status', () => {
    render(<StatusView kind="loading" />);
    expect(screen.getByRole('status')).toHaveTextContent('Caricamento…');
  });

  it('empty: heading and hint in a polite live region', () => {
    render(
      <StatusView
        kind="empty"
        title="Nessun cliente trovato"
        description="Controlla come è scritto, o cerca con le ultime 4 cifre del telefono."
      />,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Nessun cliente trovato' });
    expect(heading.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('error: alert with title, explanation and a retry that works', async () => {
    const onRetry = vi.fn<() => void>();
    render(
      <StatusView
        kind="error"
        title="Spesa non salvata"
        description="Il telefono non è connesso a internet."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Spesa non salvata');
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('error: without onRetry there is no button (the way out is elsewhere)', () => {
    render(<StatusView kind="error" title="Solo per gli amministratori" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Solo per gli amministratori');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('error: the retry label can be specific', () => {
    render(<StatusView kind="error" title="Errore" onRetry={() => {}} retryLabel="Riprova +12" />);
    expect(screen.getByRole('button', { name: 'Riprova +12' })).toBeInTheDocument();
  });
});
