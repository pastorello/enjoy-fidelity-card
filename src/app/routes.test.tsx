import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ErrorScreen } from './ErrorScreen';
import { createTestCardReader } from '../test/fakeCardReader';
import { renderApp, signedInFake } from '../test/renderApp';
import { rootRoute, routes } from './routes';

// The public points page (/s/:token) calls Supabase directly: a client that never answers.
vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    schema: () => ({
      rpc: () => ({ abortSignal: () => new Promise<never>(() => {}) }),
    }),
  }),
}));

const CARD_TOKEN = 'Zq3_x-9KpL2mN8vR4tY6wA';

function Boom(): never {
  throw new Error('boom');
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('routes', () => {
  it('shows the "Cerca cliente" home on / when signed in', async () => {
    renderApp('/', signedInFake());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Enjoy Card' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('searchbox', { name: 'Oppure cerca per nome o telefono' }),
    ).toBeInTheDocument();
  });

  it('keeps /cassa behind the sign-in: signed out → /accedi', async () => {
    const { router } = renderApp('/cassa');
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });

  describe('fallback recovery link on site_url', () => {
    it('forwards /?token_hash=…&type=recovery to /imposta-password keeping the query', async () => {
      const { router } = renderApp('/?token_hash=abc&type=recovery');
      await waitFor(() => expect(router.state.location.pathname).toBe('/imposta-password'));
      expect(router.state.location.search).toBe('?token_hash=abc&type=recovery');
      expect(router.state.historyAction).toBe('REPLACE');
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Scegli una nuova password' }),
      ).toBeInTheDocument();
    });

    it('forwards before RequireAuth: never lands on /accedi without a session', async () => {
      const { router } = renderApp('/?token_hash=abc&type=recovery');
      await screen.findByRole('heading', { level: 1, name: 'Scegli una nuova password' });
      expect(router.state.location.pathname).not.toBe('/accedi');
    });

    it('forwards also when signed in, without consuming the token', async () => {
      const { router, fake } = renderApp('/?token_hash=abc&type=recovery', signedInFake());
      await waitFor(() => expect(router.state.location.pathname).toBe('/imposta-password'));
      expect(router.state.location.search).toBe('?token_hash=abc&type=recovery');
      expect(fake.service.verifyRecovery).not.toHaveBeenCalled();
    });

    it('leaves / without a query unchanged (signed out → /accedi)', async () => {
      const { router } = renderApp('/');
      await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    });

    it('leaves / without a query unchanged (signed in → home)', async () => {
      const { router } = renderApp('/', signedInFake());
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Enjoy Card' }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/');
    });

    it.each([
      ['another type', '/?token_hash=abc&type=signup'],
      ['no token_hash', '/?type=recovery'],
    ])('does not forward with %s', async (_label, path) => {
      const { router } = renderApp(path);
      await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    });

    it('does not forward from other paths', async () => {
      const { router } = renderApp('/impostazioni?token_hash=abc&type=recovery');
      await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    });
  });

  describe('public points page /s/:token', () => {
    it('opens without an account, never sending to /accedi', async () => {
      const { router } = renderApp(`/s/${CARD_TOKEN}`);
      expect(await screen.findByText('Carico i tuoi punti…')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(`/s/${CARD_TOKEN}`);
    });

    it('does not wait for the session check', async () => {
      const fake = signedInFake();
      fake.service.currentUserId.mockReturnValue(new Promise<never>(() => {}));
      renderApp(`/s/${CARD_TOKEN}`, fake);
      expect(await screen.findByText('Carico i tuoi punti…')).toBeInTheDocument();
    });

    it("stays outside the operators' shell even with a session", async () => {
      renderApp(`/s/${CARD_TOKEN}`, signedInFake());
      expect(await screen.findByText('Carico i tuoi punti…')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Enjoy Card' })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('link')).toEqual([]);
    });

    // SPEC-cards point 9: on a staff phone with a session, the card link must not start a scan
    // (it would take the NFC from Android); the home, with the same session and reader, does.
    it('never turns the card reader on, even with an operator signed in', async () => {
      const card = createTestCardReader({ permission: 'granted' });
      renderApp(`/s/${CARD_TOKEN}`, signedInFake(), undefined, undefined, undefined, card);
      expect(await screen.findByText('Carico i tuoi punti…')).toBeInTheDocument();
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      expect(card.activate).not.toHaveBeenCalled();
      expect(card.nfc.scanCount()).toBe(0);
    });

    it('the same session and reader on / do turn it on (the check above can fail)', async () => {
      const card = createTestCardReader({ permission: 'granted' });
      renderApp('/', signedInFake(), undefined, undefined, undefined, card);
      await waitFor(() => expect(card.activate).toHaveBeenCalled());
      await waitFor(() => expect(card.nfc.scanCount()).toBeGreaterThan(0));
    });

    it("is loaded lazily, apart from the operators' screens", () => {
      const root = routes[0];
      const page = root?.children?.find((route) => route.path === 's/:token');
      expect(page?.lazy).toBeTypeOf('function');
      expect(page?.Component).toBeUndefined();
    });

    // Opened from the card, the lazy page is the first route React Router renders: without a
    // HydrateFallback it warns in the console (React Router warns once per run, so this checks the
    // route; e2e/card-points.spec.ts checks the console of a real first load).
    it('has a blank HydrateFallback for the first load from the card link', async () => {
      const root = routes[0];
      const page = root?.children?.find((route) => route.path === 's/:token');
      expect(page?.HydrateFallback).toBeTypeOf('function');

      const { container } = renderAt(`/s/${CARD_TOKEN}`);
      expect(container).toBeEmptyDOMElement();
      expect(await screen.findByText('Carico i tuoi punti…')).toBeInTheDocument();
    });
  });

  it('shows the not-found page on an unknown path', () => {
    renderAt('/does-not-exist');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Pagina non trovata' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna all’inizio' })).toHaveAttribute('href', '/');
  });

  it('shows the error screen when a route throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = createMemoryRouter(
      [{ ...rootRoute, children: [{ index: true, Component: Boom }] }],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Qualcosa è andato storto' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
  });
});

describe('ErrorScreen', () => {
  it('calls onRetry when "Riprova" is pressed', async () => {
    const onRetry = vi.fn<() => void>();
    render(<ErrorScreen onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not show technical details to the user', () => {
    render(<ErrorScreen onRetry={() => {}} />);
    expect(screen.queryByText(/boom|stack|undefined/i)).not.toBeInTheDocument();
  });
});
