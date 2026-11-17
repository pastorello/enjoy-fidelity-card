import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './app/routes';
import { AuthProvider } from './features/identity/AuthProvider';
import { supabaseAuthService } from './features/identity/supabaseAuthService';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

const router = createBrowserRouter(routes);

createRoot(container).render(
  <StrictMode>
    <AuthProvider service={supabaseAuthService}>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
