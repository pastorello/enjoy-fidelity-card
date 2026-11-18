import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { setUpServiceWorker } from './app/registerServiceWorker';
import { routes } from './app/routes';
import { createBrowserCardReader } from './features/card-input/browserCardReader';
import type { CardInputAdapter, CardWriteTarget } from './features/card-input/cardReader';
import { CardReaderProvider } from './features/card-input/CardReaderProvider';
import { CardsServiceProvider } from './features/cards/CardsServiceProvider';
import { supabaseCardsService } from './features/cards/supabaseCardsService';
import { CustomerServiceProvider } from './features/customers/CustomerServiceProvider';
import { supabaseCustomerService } from './features/customers/supabaseCustomerService';
import { LedgerServiceProvider } from './features/ledger/LedgerServiceProvider';
import { supabaseLedgerService } from './features/ledger/supabaseLedgerService';
import { RewardsServiceProvider } from './features/rewards/RewardsServiceProvider';
import { supabaseRewardsService } from './features/rewards/supabaseRewardsService';
import { AuthProvider } from './features/identity/AuthProvider';
import { supabaseAuthService } from './features/identity/supabaseAuthService';
import { SettingsServiceProvider } from './features/settings/SettingsProvider';
import { supabaseSettingsService } from './features/settings/supabaseSettingsService';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// Production build only: in `npm run dev` there is no /sw.js. Skipped on /s/:token (SPEC-cards 9).
if (import.meta.env.PROD) setUpServiceWorker(window);

const router = createBrowserRouter(routes);
// One card reader for the whole app; it reads only once CardReaderSession activates it.
const testAdapters: CardInputAdapter[] = [];
let testWriter: CardWriteTarget | undefined;
// E2E build only (SPEC-card-input, point 7): Vite replaces the constant, so in a normal build this
// block and the fake reader's chunk are left out of the bundle.
if (import.meta.env.VITE_E2E === '1') {
  const { createFakeCard } = await import('./features/card-input/fakeCardAdapter');
  const fake = createFakeCard(window);
  testAdapters.push(fake.adapter);
  testWriter = fake.writer;
}
const cardReader = createBrowserCardReader(window, {
  adapters: testAdapters,
  ...(testWriter ? { writer: testWriter } : {}),
});

createRoot(container).render(
  <StrictMode>
    <AuthProvider service={supabaseAuthService}>
      <SettingsServiceProvider service={supabaseSettingsService}>
        <CustomerServiceProvider service={supabaseCustomerService}>
          <RewardsServiceProvider service={supabaseRewardsService}>
            <CardsServiceProvider service={supabaseCardsService}>
              <LedgerServiceProvider service={supabaseLedgerService}>
                <CardReaderProvider reader={cardReader}>
                  <RouterProvider router={router} />
                </CardReaderProvider>
              </LedgerServiceProvider>
            </CardsServiceProvider>
          </RewardsServiceProvider>
        </CustomerServiceProvider>
      </SettingsServiceProvider>
    </AuthProvider>
  </StrictMode>,
);
