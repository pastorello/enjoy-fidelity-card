import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../app/routes';
import { AuthProvider } from '../features/identity/AuthProvider';
import { SettingsServiceProvider } from '../features/settings/SettingsProvider';
import { createFakeAuthService } from './fakeAuthService';
import { createFakeSettingsService } from './fakeSettingsService';

/** Renders the whole app at `path`, with fake Auth and Settings services instead of Supabase. */
export function renderApp(
  path: string,
  fake = createFakeAuthService(),
  settings = createFakeSettingsService(),
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider service={fake.service}>
      <SettingsServiceProvider service={settings.service}>
        <RouterProvider router={router} />
      </SettingsServiceProvider>
    </AuthProvider>,
  );
  return { router, fake, settings };
}

/** A fake with a session already saved on the device. */
export function signedInFake(options: Parameters<typeof createFakeAuthService>[0] = {}) {
  return createFakeAuthService({ userId: 'user-1', ...options });
}
