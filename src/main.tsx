import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './app/routes';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

const router = createBrowserRouter(routes);

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
