import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './app/routes';
import { createBrowserCardReader } from './features/card-input/browserCardReader';
import { CardReaderProvider } from './features/card-input/CardReaderProvider';
import { CustomerServiceProvider } from './features/customers/CustomerServiceProvider';
import { supabaseCustomerService } from './features/customers/supabaseCustomerService';
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

const router = createBrowserRouter(routes);
// One card reader for the whole app; it reads only once CardReaderSession activates it.
const cardReader = createBrowserCardReader(window);

createRoot(container).render(
  <StrictMode>
    <AuthProvider service={supabaseAuthService}>
      <SettingsServiceProvider service={supabaseSettingsService}>
        <CustomerServiceProvider service={supabaseCustomerService}>
          <RewardsServiceProvider service={supabaseRewardsService}>
            <CardReaderProvider reader={cardReader}>
              <RouterProvider router={router} />
            </CardReaderProvider>
          </RewardsServiceProvider>
        </CustomerServiceProvider>
      </SettingsServiceProvider>
    </AuthProvider>
  </StrictMode>,
);
