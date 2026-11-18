import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardPointsPage } from './CardPointsPage';

type Answer = { data: unknown; error: unknown; status: number };

// The real cardPointsService runs (token check, POST, 8 s timeout); only the client is fake.
const db = vi.hoisted(() => ({
  rpc: vi.fn<(...args: unknown[]) => unknown>(),
  abortSignal: vi.fn<(signal: AbortSignal) => Promise<unknown>>(),
}));
vi.mock('../../../lib/supabase', () => ({
  getSupabase: () => ({ schema: () => ({ rpc: db.rpc }) }),
}));

const TOKEN = 'Zq3_x-9KpL2mN8vR4tY6wA';

function answers(...list: Answer[]) {
  for (const answer of list) db.abortSignal.mockResolvedValueOnce(answer);
}

/** The page alone, as the router mounts it: no AuthProvider and no other provider around it. */
function renderPage(token = TOKEN) {
  const router = createMemoryRouter([{ path: '/s/:token', Component: CardPointsPage }], {
    initialEntries: [`/s/${token}`],
  });
  render(<RouterProvider router={router} />);
}

function robotsMeta() {
  return document.head.querySelector('meta[name="robots"]');
}

beforeEach(() => {
  db.rpc.mockReset().mockImplementation(() => ({ abortSignal: db.abortSignal }));
  db.abortSignal.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CardPointsPage', () => {
  it('shows «Carico i tuoi punti…» while the points load', async () => {
    db.abortSignal.mockReturnValue(new Promise<never>(() => {}));
    renderPage();
    expect(await screen.findByText('Carico i tuoi punti…')).toBeInTheDocument();
  });

  it('shows the points of the card (Saldo-punti) and nothing else', async () => {
    answers({ data: 120, error: null, status: 200 });
    renderPage();

    const heading = await screen.findByRole('heading', { level: 1, name: 'ENJOY YOUR POINTS' });
    expect(heading).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('img', { name: 'Bar Enjoy Gaeta' })).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'ENJOY YOUR POINTS' });
    expect(within(panel).getByText('120')).toBeInTheDocument();
    expect(within(panel).getByText('punti')).toBeInTheDocument();
    expect(
      screen.getByText('Mostra la card alla cassa per usare i tuoi punti.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Questa pagina mostra solo i punti della card, senza dati personali.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enjoy Bar · Gaeta')).toBeInTheDocument();
    // No name, no other data (criterion 10): the whole text of the page is the board's.
    expect(document.body.textContent).toBe(
      'ENJOY YOUR POINTS120 puntiMostra la card alla cassa per usare i tuoi punti.' +
        'Questa pagina mostra solo i punti della card, senza dati personali.Enjoy Bar · Gaeta',
    );
    // No way into the operators' screens.
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('card_points', { p_token: TOKEN });
  });

  it('groups the thousands as it-IT does', async () => {
    answers({ data: 12345, error: null, status: 200 });
    renderPage();
    expect(await screen.findByText('12.345')).toBeInTheDocument();
  });

  it.each([
    [0, 'punti'],
    [1, 'punto'],
    [2, 'punti'],
  ])('says «%s %s»', async (points, word) => {
    answers({ data: points, error: null, status: 200 });
    renderPage();
    const panel = await screen.findByRole('region', { name: 'ENJOY YOUR POINTS' });
    expect(within(panel).getByText(String(points))).toBeInTheDocument();
    expect(within(panel).getByText(word)).toBeInTheDocument();
  });

  it('shows «Card non attiva» when the server answers null', async () => {
    answers({ data: null, error: null, status: 200 });
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Card non attiva' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Questa card non mostra punti. Chiedi al bar.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bar Enjoy Gaeta' })).toBeInTheDocument();
    expect(screen.getByText('Enjoy Bar · Gaeta')).toBeInTheDocument();
    expect(screen.queryByText(/ENJOY YOUR POINTS/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['21 characters', TOKEN.slice(1)],
    ['23 characters', `${TOKEN}A`],
    ['a character outside base64url', `${TOKEN.slice(1)}.`],
  ])('shows the same neutral message for a token with %s, without calling', async (_l, token) => {
    renderPage(token);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Card non attiva' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Carico i tuoi punti…')).not.toBeInTheDocument();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('offers «Riprova» when the network fails, and loads again', async () => {
    answers(
      { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 },
      { data: 7, error: null, status: 200 },
    );
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Non riesco a caricare i punti.')).toBeInTheDocument();
    expect(within(alert).getByText('Controlla la connessione.')).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'ENJOY YOUR POINTS' }),
    ).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it('treats 8 seconds without an answer as a network error', async () => {
    vi.useFakeTimers();
    db.abortSignal.mockReturnValue(new Promise<never>(() => {}));
    renderPage();
    await act(() => vi.advanceTimersByTimeAsync(7_999));
    expect(screen.getByText('Carico i tuoi punti…')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
  });

  it('asks search engines not to index the page while it is shown', async () => {
    answers({ data: 3, error: null, status: 200 });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'ENJOY YOUR POINTS' });
    expect(robotsMeta()).toHaveAttribute('content', 'noindex, nofollow');
  });

  it('keeps the token out of the title, the storage and the DOM text', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    answers({ data: 3, error: null, status: 200 });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'ENJOY YOUR POINTS' });

    expect(document.title).not.toContain(TOKEN);
    expect(document.documentElement.outerHTML).not.toContain(TOKEN);
    expect(setItem).not.toHaveBeenCalled();
  });
});

/** The h1 headings on the page now. */
function h1s() {
  return screen.queryAllByRole('heading', { level: 1 });
}

describe('CardPointsPage: one h1 in every state, for whoever jumps by headings', () => {
  it('while loading: the page title, hidden, and no other heading', async () => {
    db.abortSignal.mockReturnValue(new Promise<never>(() => {}));
    renderPage();
    await screen.findByText('Carico i tuoi punti…');
    expect(h1s()).toHaveLength(1);
    expect(h1s()[0]).toHaveTextContent('I tuoi punti Enjoy');
    expect(h1s()[0]).toHaveClass('visually-hidden');
  });

  it('on a network error: the page title, then the error as its sub-heading', async () => {
    answers({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 });
    renderPage();
    await screen.findByRole('alert');
    expect(h1s()).toHaveLength(1);
    expect(h1s()[0]).toHaveTextContent('I tuoi punti Enjoy');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Non riesco a caricare i punti.',
    );
  });

  it('with the points: «ENJOY YOUR POINTS» only', async () => {
    answers({ data: 120, error: null, status: 200 });
    renderPage();
    await screen.findByText('120');
    expect(h1s()).toHaveLength(1);
    expect(h1s()[0]).toHaveTextContent('ENJOY YOUR POINTS');
  });

  it('a card without points: «Card non attiva» only', async () => {
    answers({ data: null, error: null, status: 200 });
    renderPage();
    await screen.findByText('Questa card non mostra punti. Chiedi al bar.');
    expect(h1s()).toHaveLength(1);
    expect(h1s()[0]).toHaveTextContent('Card non attiva');
  });
});
