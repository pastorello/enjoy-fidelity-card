import type { RouteObject } from 'react-router';
import { ForgotPasswordPage } from '../features/identity/ForgotPasswordPage';
import { LoginPage } from '../features/identity/LoginPage';
import { RequireAuth } from '../features/identity/RequireAuth';
import { SettingsPage } from '../features/identity/SettingsPage';
import { HomePage } from './HomePage';
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
      // Every page below needs a signed-in operator.
      {
        Component: RequireAuth,
        children: [
          { index: true, Component: HomePage },
          { path: 'impostazioni', Component: SettingsPage },
        ],
      },
      // Component showcase, development builds only.
      ...(import.meta.env.DEV ? [{ path: 'dev/ui', Component: UiGallery }] : []),
      { path: '*', Component: NotFoundPage },
    ],
  },
];
