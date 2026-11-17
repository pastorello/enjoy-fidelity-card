import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../app/routes';
import { AuthProvider } from '../features/identity/AuthProvider';
import { createFakeAuthService } from './fakeAuthService';

/** Renders the whole app at `path`, with a fake AuthService instead of Supabase. */
export function renderApp(path: string, fake = createFakeAuthService()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider service={fake.service}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { router, fake };
}

/** A fake with a session already saved on the device. */
export function signedInFake(options: Parameters<typeof createFakeAuthService>[0] = {}) {
  return createFakeAuthService({ userId: 'user-1', ...options });
}
