import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../app/routes';
import { CardReaderProvider } from '../features/card-input/CardReaderProvider';
import { CardsServiceProvider } from '../features/cards/CardsServiceProvider';
import { CustomerServiceProvider } from '../features/customers/CustomerServiceProvider';
import { ExportServiceProvider } from '../features/export/ExportServiceProvider';
import { AuthProvider } from '../features/identity/AuthProvider';
import { LedgerServiceProvider } from '../features/ledger/LedgerServiceProvider';
import { OperatorsServiceProvider } from '../features/operators/OperatorsServiceProvider';
import { RewardsServiceProvider } from '../features/rewards/RewardsServiceProvider';
import { SettingsServiceProvider } from '../features/settings/SettingsProvider';
import { KioskServiceProvider } from '../features/tablet-kiosk/KioskServiceProvider';
import { createFakeAuthService } from './fakeAuthService';
import { createTestCardReader } from './fakeCardReader';
import { createFakeCardsService } from './fakeCardsService';
import { createFakeCustomerService } from './fakeCustomerService';
import { createFakeExportService } from './fakeExportService';
import { createFakeKioskService } from './fakeKioskService';
import { createFakeLedgerService } from './fakeLedgerService';
import { createFakeOperatorsService } from './fakeOperatorsService';
import { createFakeRewardsService } from './fakeRewardsService';
import { createFakeSettingsService } from './fakeSettingsService';

/**
 * Renders the whole app at `path`, with fake Auth, Settings, Customer, Rewards, Cards, Ledger,
 * Export, Kiosk and Operators services instead of Supabase (the export fake's download spy instead of saving files), and
 * a card reader with `fakeWebNfc` and the USB wedge on jsdom's `document`. The cards fake reads (and creates) its customers in `customers`, and the ledger fake
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
  exportService = createFakeExportService(),
  kiosk = createFakeKioskService(),
  operators = createFakeOperatorsService(),
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider service={fake.service}>
      <SettingsServiceProvider service={settings.service}>
        <CustomerServiceProvider service={customers.service}>
          <RewardsServiceProvider service={rewards.service}>
            <CardsServiceProvider service={cards.service}>
              <LedgerServiceProvider service={ledger.service}>
                <ExportServiceProvider
                  service={exportService.service}
                  download={exportService.download}
                >
                  <KioskServiceProvider service={kiosk.service}>
                    <OperatorsServiceProvider service={operators.service}>
                      <CardReaderProvider reader={card.reader}>
                        <RouterProvider router={router} />
                      </CardReaderProvider>
                    </OperatorsServiceProvider>
                  </KioskServiceProvider>
                </ExportServiceProvider>
              </LedgerServiceProvider>
            </CardsServiceProvider>
          </RewardsServiceProvider>
        </CustomerServiceProvider>
      </SettingsServiceProvider>
    </AuthProvider>,
  );
  return {
    router,
    fake,
    settings,
    customers,
    rewards,
    card,
    cards,
    ledger,
    exportService,
    kiosk,
    operators,
  };
}

/** A fake with a session already saved on the device. */
export function signedInFake(options: Parameters<typeof createFakeAuthService>[0] = {}) {
  return createFakeAuthService({ userId: 'user-1', ...options });
}
