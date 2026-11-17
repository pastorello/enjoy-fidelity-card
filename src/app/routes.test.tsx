import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ErrorScreen } from './ErrorScreen';
import { renderApp, signedInFake } from '../test/renderApp';
import { rootRoute, routes } from './routes';

function Boom(): never {
  throw new Error('boom');
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('routes', () => {
  it('shows the placeholder home on / when signed in', async () => {
    renderApp('/', signedInFake());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Enjoy Card' }),
    ).toBeInTheDocument();
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
