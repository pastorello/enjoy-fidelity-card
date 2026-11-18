import type { RouteObject } from 'react-router';
import { AssociateCardPage } from '../features/cards/AssociateCardPage';
import { PurchasePlaceholderPage } from '../features/cards/PurchasePlaceholderPage';
import { EditCustomerPage } from '../features/customers/EditCustomerPage';
import { CustomerPage } from '../features/customers/CustomerPage';
import { HomePage } from '../features/customers/HomePage';
import { NewCustomerPage } from '../features/customers/NewCustomerPage';
import { ForgotPasswordPage } from '../features/identity/ForgotPasswordPage';
import { LoginPage } from '../features/identity/LoginPage';
import { RequireAuth } from '../features/identity/RequireAuth';
import { ResetPasswordPage } from '../features/identity/ResetPasswordPage';
import { SettingsPage } from '../features/identity/SettingsPage';
import { RewardsCatalogPage } from '../features/rewards/RewardsCatalogPage';
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
      // The customer's points page behind the card link: public, outside RequireAuth and AppShell,
      // in its own chunk so a customer never downloads the operators' screens.
      {
        path: 's/:token',
        lazy: async () => {
          const { CardPointsPage } = await import('../features/cards/public/CardPointsPage');
          return { Component: CardPointsPage };
        },
      },
      // Every page below needs a signed-in operator.
      {
        Component: RequireAuth,
        children: [
          { index: true, Component: HomePage },
          { path: 'clienti/nuovo', Component: NewCustomerPage },
          { path: 'clienti/:id', Component: CustomerPage },
          { path: 'clienti/:id/modifica', Component: EditCustomerPage },
          { path: 'clienti/:id/card', Component: AssociateCardPage },
          // A placeholder until `ledger` builds Registra spesa on the same route.
          { path: 'clienti/:id/spesa', Component: PurchasePlaceholderPage },
          { path: 'impostazioni', Component: SettingsPage },
          { path: 'impostazioni/premi', Component: RewardsCatalogPage },
        ],
      },
      // Component showcase, development builds only.
      ...(import.meta.env.DEV ? [{ path: 'dev/ui', Component: UiGallery }] : []),
      { path: '*', Component: NotFoundPage },
    ],
  },
];
