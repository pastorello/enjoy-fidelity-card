import type { RouteObject } from 'react-router';
import { CustomerPage } from '../features/customers/CustomerPage';
import { HomePage } from '../features/customers/HomePage';
import { NewCustomerPage } from '../features/customers/NewCustomerPage';
import { ForgotPasswordPage } from '../features/identity/ForgotPasswordPage';
import { LoginPage } from '../features/identity/LoginPage';
import { RequireAuth } from '../features/identity/RequireAuth';
import { ResetPasswordPage } from '../features/identity/ResetPasswordPage';
import { SettingsPage } from '../features/identity/SettingsPage';
import { NotFoundPage } from './NotFoundPage';
import { RootLayout } from './RootLayout';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { UiGallery } from './dev/UiGallery';

export const rootRoute = {
  path: '/',
  Component: RootLayout,
  ErrorBoundary: RouteErrorBoundary,
} satisfies RouteObject;

export const routes: RouteObject[] = [
  {
    ...rootRoute,
    children: [
      { path: 'accedi', Component: LoginPage },
      { path: 'password-dimenticata', Component: ForgotPasswordPage },
      { path: 'imposta-password', Component: ResetPasswordPage },
      // Every page below needs a signed-in operator.
      {
        Component: RequireAuth,
        children: [
          { index: true, Component: HomePage },
          { path: 'clienti/nuovo', Component: NewCustomerPage },
          { path: 'clienti/:id', Component: CustomerPage },
          { path: 'impostazioni', Component: SettingsPage },
        ],
      },
      // Component showcase, development builds only.
      ...(import.meta.env.DEV ? [{ path: 'dev/ui', Component: UiGallery }] : []),
      { path: '*', Component: NotFoundPage },
    ],
  },
];
