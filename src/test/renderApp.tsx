import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../app/routes';
import { CardReaderProvider } from '../features/card-input/CardReaderProvider';
import { CardsServiceProvider } from '../features/cards/CardsServiceProvider';
import { CustomerServiceProvider } from '../features/customers/CustomerServiceProvider';
import { AuthProvider } from '../features/identity/AuthProvider';
import { LedgerServiceProvider } from '../features/ledger/LedgerServiceProvider';
import { RewardsServiceProvider } from '../features/rewards/RewardsServiceProvider';
import { SettingsServiceProvider } from '../features/settings/SettingsProvider';
import { createFakeAuthService } from './fakeAuthService';
import { createTestCardReader } from './fakeCardReader';
import { createFakeCardsService } from './fakeCardsService';
import { createFakeCustomerService } from './fakeCustomerService';
import { createFakeLedgerService } from './fakeLedgerService';
import { createFakeRewardsService } from './fakeRewardsService';
import { createFakeSettingsService } from './fakeSettingsService';

/**
 * Renders the whole app at `path`, with fake Auth, Settings, Customer, Rewards, Cards and Ledger
 * services instead of Supabase, and a card reader with `fakeWebNfc` and the USB wedge on jsdom's
 * `document`. The cards fake reads (and creates) its customers in `customers`, and the ledger fake
 * reads `customers`, `rewards` and `settings` (and writes balances in `customers`), unless one is
 * passed.
 */
export function renderApp(
  path: string,
  fake = createFakeAuthService(),
  settings = createFakeSettingsService(),
  customers = createFakeCustomerService(),
  rewards = createFakeRewardsService(),
  card = createTestCardReader(),
  cards = createFakeCardsService({ customers }),
  ledger = createFakeLedgerService({ customers, rewards, settings }),
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider service={fake.service}>
      <SettingsServiceProvider service={settings.service}>
        <CustomerServiceProvider service={customers.service}>
          <RewardsServiceProvider service={rewards.service}>
            <CardsServiceProvider service={cards.service}>
              <LedgerServiceProvider service={ledger.service}>
                <CardReaderProvider reader={card.reader}>
                  <RouterProvider router={router} />
                </CardReaderProvider>
              </LedgerServiceProvider>
            </CardsServiceProvider>
          </RewardsServiceProvider>
        </CustomerServiceProvider>
      </SettingsServiceProvider>
    </AuthProvider>,
  );
  return { router, fake, settings, customers, rewards, card, cards, ledger };
}

/** A fake with a session already saved on the device. */
export function signedInFake(options: Parameters<typeof createFakeAuthService>[0] = {}) {
  return createFakeAuthService({ userId: 'user-1', ...options });
}
