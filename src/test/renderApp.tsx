import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../app/routes';
import { CustomerServiceProvider } from '../features/customers/CustomerServiceProvider';
import { AuthProvider } from '../features/identity/AuthProvider';
import { RewardsServiceProvider } from '../features/rewards/RewardsServiceProvider';
import { SettingsServiceProvider } from '../features/settings/SettingsProvider';
import { createFakeAuthService } from './fakeAuthService';
import { createFakeCustomerService } from './fakeCustomerService';
import { createFakeRewardsService } from './fakeRewardsService';
import { createFakeSettingsService } from './fakeSettingsService';

/** Renders the whole app at `path`, with fake Auth, Settings, Customer and Rewards services instead of Supabase. */
export function renderApp(
  path: string,
  fake = createFakeAuthService(),
  settings = createFakeSettingsService(),
  customers = createFakeCustomerService(),
  rewards = createFakeRewardsService(),
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider service={fake.service}>
      <SettingsServiceProvider service={settings.service}>
        <CustomerServiceProvider service={customers.service}>
          <RewardsServiceProvider service={rewards.service}>
            <RouterProvider router={router} />
          </RewardsServiceProvider>
        </CustomerServiceProvider>
      </SettingsServiceProvider>
    </AuthProvider>,
  );
  return { router, fake, settings, customers, rewards };
}

/** A fake with a session already saved on the device. */
export function signedInFake(options: Parameters<typeof createFakeAuthService>[0] = {}) {
  return createFakeAuthService({ userId: 'user-1', ...options });
}
