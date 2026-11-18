import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerDoneView, type LedgerDoneViewProps } from './LedgerDoneView';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';

const PURCHASE: LedgerDoneViewProps = {
  title: 'Spesa registrata',
  summary: '+12 punti a Maria Rossi',
  balance: 132,
  details: '12,50 € · oggi 10:42 · Giulia',
  customerId: CUSTOMER_ID,
  customerName: 'Maria Rossi',
  cancelLabel: 'Annulla la spesa',
};

function renderDone(props: Partial<LedgerDoneViewProps> = {}) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Home</p> },
      { path: '/clienti/:id', element: <p>Scheda</p> },
      { path: '/clienti/:id/spesa', element: <LedgerDoneView {...PURCHASE} {...props} /> },
    ],
    { initialEntries: ['/', `/clienti/${CUSTOMER_ID}/spesa`], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  return { router };
}

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
    renderDone({ onCancel: vi.fn<() => void>() });

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
    const { router } = renderDone({ onCancel: vi.fn<() => void>() });

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

  it('without onCancel there is no "Annulla" button', () => {
    renderDone();
    expect(screen.queryByRole('button', { name: /^Annulla/ })).not.toBeInTheDocument();
  });

  it('"Annulla la spesa" calls onCancel', () => {
    const onCancel = vi.fn<() => void>();
    renderDone({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla la spesa · 10 s' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
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
