import { render, screen } from '@testing-library/react';
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
