import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { fakeMovement } from '../../test/fakeLedgerService';
import { LedgerDoneView, type LedgerDoneViewProps } from './LedgerDoneView';
import { LedgerError, type LedgerResult } from './types';
import { useOperation } from './useOperation';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';

const PURCHASE: LedgerDoneViewProps = {
  title: 'Spesa registrata',
  summary: '+12 punti a Maria Rossi',
  balance: 132,
  details: '12,50 € · oggi 10:42 · Giulia',
  customerId: CUSTOMER_ID,
  customerName: 'Maria Rossi',
  cancelLabel: 'Annulla la spesa',
  cancelledTitle: 'Spesa annullata',
};

type CancelRun = (operationId: string) => Promise<LedgerResult>;

/** The view with its cancellation wired to `run`, as the pages do with `useOperation`. */
function Harness({ run, ...props }: Partial<LedgerDoneViewProps> & { run?: CancelRun }) {
  const cancel = useOperation<LedgerResult>(run ?? (() => Promise.reject(new Error('unused'))));
  return <LedgerDoneView {...PURCHASE} {...props} cancel={run ? cancel : undefined} />;
}

function renderDone(props: Partial<LedgerDoneViewProps> & { run?: CancelRun } = {}) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Home</p> },
      { path: '/clienti/:id', element: <p>Scheda</p> },
      { path: '/clienti/:id/spesa', element: <Harness {...props} /> },
    ],
    { initialEntries: ['/', `/clienti/${CUSTOMER_ID}/spesa`], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  return { router };
}

/** A cancellation the test settles by hand: one pending answer per call. */
function controlledCancel() {
  const calls: {
    id: string;
    resolve: (value: LedgerResult) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const run = vi.fn<CancelRun>(
    (id) =>
      new Promise<LedgerResult>((resolve, reject) => {
        calls.push({ id, resolve, reject });
      }),
  );
  return { run, calls };
}

const CORRECTION: LedgerResult = {
  movement: fakeMovement({ kind: 'correction', points: -12, amountCents: null }),
  balance: 120,
};

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let vibrate: ReturnType<typeof vi.fn<(pattern: VibratePattern) => boolean>>;

beforeEach(() => {
  vi.useFakeTimers();
  vibrate = vi.fn<(pattern: VibratePattern) => boolean>(() => true);
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('LedgerDoneView: Spesa registrata', () => {
  it('the texts of the wireframe, with no header, and the focus on the title', () => {
    renderDone({ run: controlledCancel().run });

    const title = screen.getByRole('heading', { level: 1, name: 'Spesa registrata' });
    expect(title).toHaveFocus();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByText('+12 punti a Maria Rossi')).toBeInTheDocument();
    const balance = screen.getByRole('region', { name: 'Nuovo saldo' });
    expect(balance).toHaveTextContent('NUOVO SALDO');
    expect(balance).toHaveTextContent('132 punti');
    expect(screen.getByText('12,50 € · oggi 10:42 · Giulia')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla la spesa · 10 s' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(
      'Torno alla lettura delle card tra 10 secondi',
    );
    expect(screen.getByRole('link', { name: 'Leggi un’altra card' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Apri la scheda di Maria' })).toHaveAttribute(
      'href',
      `/clienti/${CUSTOMER_ID}`,
    );
  });

  it('the progress bar is decorative', () => {
    renderDone();
    const bar = document.querySelector('[data-progress]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('the balance is grouped and "punto" when it is one', () => {
    renderDone({ balance: 1 });
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('1 punto');
  });

  it('a large balance is grouped', () => {
    renderDone({ balance: 12_345 });
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('12.345 punti');
  });

  it('vibrates once for 200 ms', async () => {
    renderDone();
    await advance(3000);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(200);
  });

  it('works without navigator.vibrate', () => {
    Reflect.deleteProperty(navigator, 'vibrate');
    renderDone();
    expect(screen.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeInTheDocument();
  });

  it('counts down every second and goes back to / after 10 s, replacing the entry (criterion 3)', async () => {
    const { router } = renderDone({ run: controlledCancel().run });

    await advance(2000);
    expect(screen.getByRole('timer')).toHaveTextContent(
      'Torno alla lettura delle card tra 8 secondi',
    );
    expect(screen.getByRole('button', { name: 'Annulla la spesa · 8 s' })).toBeInTheDocument();

    await advance(7000);
    expect(screen.getByRole('timer')).toHaveTextContent(
      'Torno alla lettura delle card tra 1 secondo',
    );
    expect(router.state.location.pathname).toBe(`/clienti/${CUSTOMER_ID}/spesa`);

    await advance(1000);
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('Home')).toBeInTheDocument();
    // `replace`: the confirmation is not in the history any more, behind is the first entry.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('without a cancellation there is no "Annulla" button', () => {
    renderDone();
    expect(screen.queryByRole('button', { name: /^Annulla/ })).not.toBeInTheDocument();
  });

  it('"Leggi un’altra card" goes to / at once, replacing the entry', async () => {
    const { router } = renderDone();
    fireEvent.click(screen.getByRole('link', { name: 'Leggi un’altra card' }));
    await advance(0);
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.historyAction).toBe('REPLACE');
    // No second navigation when the countdown would have run out.
    await advance(15_000);
    expect(router.state.location.pathname).toBe('/');
  });

  it('"Apri la scheda di Maria" opens the customer page and stops the countdown', async () => {
    const { router } = renderDone();
    fireEvent.click(screen.getByRole('link', { name: 'Apri la scheda di Maria' }));
    await advance(0);
    expect(router.state.location.pathname).toBe(`/clienti/${CUSTOMER_ID}`);
    await advance(15_000);
    expect(router.state.location.pathname).toBe(`/clienti/${CUSTOMER_ID}`);
  });
});

describe('LedgerDoneView: Annulla la spesa', () => {
  const NETWORK_TEXT = 'Annullamento non riuscito: controlla la connessione e riprova.';

  it('one tap, no dialog: a single call with a new operation id, busy, the countdown stopped', async () => {
    const { run, calls } = controlledCancel();
    const { router } = renderDone({ run });
    await advance(2000);

    const button = screen.getByRole('button', { name: 'Annulla la spesa · 8 s' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(run).toHaveBeenCalledTimes(1);
    expect(calls[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Annulla la spesa/ })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    await advance(15_000);
    expect(screen.getByRole('timer')).toHaveTextContent(
      'Torno alla lettura delle card tra 8 secondi',
    );
    expect(router.state.location.pathname).toBe(`/clienti/${CUSTOMER_ID}/spesa`);
  });

  it('done: "Spesa annullata" focused, the server’s balance, no return (criterion 8)', async () => {
    const { run, calls } = controlledCancel();
    const { router } = renderDone({ run });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 10 s' }));
    await act(async () => {
      calls[0]?.resolve(CORRECTION);
    });

    const title = screen.getByRole('heading', { level: 1, name: 'Spesa annullata' });
    expect(title).toHaveFocus();
    expect(screen.queryByRole('heading', { name: 'Spesa registrata' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nuovo saldo' })).toHaveTextContent('120 punti');
    // The points added are struck out, as a cancelled movement in Movimenti.
    expect(screen.getByText('+12 punti a Maria Rossi').closest('del')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Annulla/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(document.querySelector('[data-progress]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Leggi un’altra card' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri la scheda di Maria' })).toBeInTheDocument();

    await advance(30_000);
    expect(router.state.location.pathname).toBe(`/clienti/${CUSTOMER_ID}/spesa`);
  });

  it('time out (cancel-window-expired): the text, no button, back to / after 3 s', async () => {
    const { run, calls } = controlledCancel();
    const { router } = renderDone({ run });
    await advance(9000);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 1 s' }));
    await advance(2000);
    await act(async () => {
      calls[0]?.reject(new LedgerError('cancel-window-expired'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tempo scaduto: per annullare ora serve un amministratore.',
    );
    expect(screen.queryByRole('button', { name: /^Annulla|^Riprova/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Spesa registrata' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(
      'Torno alla lettura delle card tra 3 secondi',
    );

    await advance(2000);
    expect(router.state.location.pathname).toBe(`/clienti/${CUSTOMER_ID}/spesa`);
    await advance(1000);
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('points already spent: its own text and back to / after 3 s', async () => {
    const { run, calls } = controlledCancel();
    const { router } = renderDone({ run });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 10 s' }));
    await act(async () => {
      calls[0]?.reject(new LedgerError('insufficient-balance'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Punti già spesi: questa spesa non si può più annullare.',
    );
    await advance(3000);
    expect(router.state.location.pathname).toBe('/');
  });

  it('network error: the text, "Riprova" with the same id, the countdown stopped', async () => {
    const { run, calls } = controlledCancel();
    const { router } = renderDone({ run });
    await advance(3000);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 7 s' }));
    await act(async () => {
      calls[0]?.reject(new LedgerError('network'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(NETWORK_TEXT);
    expect(screen.queryByRole('button', { name: /^Annulla la spesa/ })).not.toBeInTheDocument();
    await advance(20_000);
    expect(router.state.location.pathname).toBe(`/clienti/${CUSTOMER_ID}/spesa`);
    expect(screen.getByRole('timer')).toHaveTextContent(
      'Torno alla lettura delle card tra 7 secondi',
    );

    const retry = screen.getByRole('button', { name: 'Riprova' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(run).toHaveBeenCalledTimes(2);
    expect(calls[1]?.id).toBe(calls[0]?.id);
    expect(screen.getByRole('button', { name: 'Riprova' })).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      calls[1]?.resolve(CORRECTION);
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Spesa annullata' })).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a server fault is retried like the network', async () => {
    const { run, calls } = controlledCancel();
    renderDone({ run });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 10 s' }));
    await act(async () => {
      calls[0]?.reject(new ServerFaultError('unavailable'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(NETWORK_TEXT);
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
  });

  it('the button is gone after 10 s', async () => {
    renderDone({ run: controlledCancel().run });
    await advance(9000);
    expect(screen.getByRole('button', { name: 'Annulla la spesa · 1 s' })).toBeInTheDocument();
    await advance(1000);
    expect(screen.queryByRole('button', { name: /^Annulla la spesa/ })).not.toBeInTheDocument();
  });
});
