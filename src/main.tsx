import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './app/routes';
import { CustomerServiceProvider } from './features/customers/CustomerServiceProvider';
import { supabaseCustomerService } from './features/customers/supabaseCustomerService';
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

createRoot(container).render(
  <StrictMode>
    <AuthProvider service={supabaseAuthService}>
      <SettingsServiceProvider service={supabaseSettingsService}>
        <CustomerServiceProvider service={supabaseCustomerService}>
          <RouterProvider router={router} />
        </CustomerServiceProvider>
      </SettingsServiceProvider>
    </AuthProvider>
  </StrictMode>,
);
