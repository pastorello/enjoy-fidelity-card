import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../app/routes';
import { CardReaderProvider } from '../features/card-input/CardReaderProvider';
import { CustomerServiceProvider } from '../features/customers/CustomerServiceProvider';
import { AuthProvider } from '../features/identity/AuthProvider';
import { RewardsServiceProvider } from '../features/rewards/RewardsServiceProvider';
import { SettingsServiceProvider } from '../features/settings/SettingsProvider';
import { createFakeAuthService } from './fakeAuthService';
import { createTestCardReader } from './fakeCardReader';
import { createFakeCustomerService } from './fakeCustomerService';
import { createFakeRewardsService } from './fakeRewardsService';
import { createFakeSettingsService } from './fakeSettingsService';

/**
 * Renders the whole app at `path`, with fake Auth, Settings, Customer and Rewards services instead of
 * Supabase, and a card reader with `fakeWebNfc` and the USB wedge on jsdom's `document`.
 */
export function renderApp(
  path: string,
  fake = createFakeAuthService(),
  settings = createFakeSettingsService(),
  customers = createFakeCustomerService(),
  rewards = createFakeRewardsService(),
  card = createTestCardReader(),
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider service={fake.service}>
      <SettingsServiceProvider service={settings.service}>
        <CustomerServiceProvider service={customers.service}>
          <RewardsServiceProvider service={rewards.service}>
            <CardReaderProvider reader={card.reader}>
              <RouterProvider router={router} />
            </CardReaderProvider>
          </RewardsServiceProvider>
        </CustomerServiceProvider>
      </SettingsServiceProvider>
    </AuthProvider>,
  );
  return { router, fake, settings, customers, rewards, card };
}

/** A fake with a session already saved on the device. */
export function signedInFake(options: Parameters<typeof createFakeAuthService>[0] = {}) {
  return createFakeAuthService({ userId: 'user-1', ...options });
}
