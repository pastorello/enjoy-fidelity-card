import type { RouteObject } from 'react-router';
import { AssociateCardPage } from '../features/cards/AssociateCardPage';
import { InactiveCardPage } from '../features/cards/InactiveCardPage';
import { EditCustomerPage } from '../features/customers/EditCustomerPage';
import { CustomerPage } from '../features/customers/CustomerPage';
import { HomePage } from '../features/customers/HomePage';
import { NewCustomerPage } from '../features/customers/NewCustomerPage';
import { ForgotPasswordPage } from '../features/identity/ForgotPasswordPage';
import { LoginPage } from '../features/identity/LoginPage';
import { RequireAuth } from '../features/identity/RequireAuth';
import { ResetPasswordPage } from '../features/identity/ResetPasswordPage';
import { SettingsPage } from '../features/identity/SettingsPage';
import { MovementsPage } from '../features/ledger/MovementsPage';
import { PurchasePage } from '../features/ledger/PurchasePage';
import { RedeemPage } from '../features/ledger/RedeemPage';
import { RewardsCatalogPage } from '../features/rewards/RewardsCatalogPage';
import { CashierPage } from '../features/tablet-kiosk/CashierPage';
import { PinSettingsPage } from '../features/tablet-kiosk/PinSettingsPage';
import { RequireCashier } from '../features/tablet-kiosk/RequireCashier';
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
        // Shown while the chunk loads on the first load from the card: blank, as before the page's
        // own «Carico i tuoi punti…». Without it React Router warns in the console.
        HydrateFallback: () => null,
        lazy: async () => {
          const { CardPointsPage } = await import('../features/cards/public/CardPointsPage');
          return { Component: CardPointsPage };
        },
      },
      // Every page below needs a signed-in account.
      {
        Component: RequireAuth,
        children: [
          // The till tablet chooses its cashier here, without one (SPEC-tablet-kiosk, point 3).
          { path: 'cassa', Component: CashierPage },
          // These need an operator at work: on a device, a cashier whose turn is running.
          {
            Component: RequireCashier,
            children: [
              { index: true, Component: HomePage },
              { path: 'clienti/nuovo', Component: NewCustomerPage },
              { path: 'clienti/:id', Component: CustomerPage },
              { path: 'clienti/:id/modifica', Component: EditCustomerPage },
              { path: 'clienti/:id/card', Component: AssociateCardPage },
              // A card that is not active, by the id of its row: never the uid (SPEC-customers-v2, 4).
              { path: 'card/:cardId', Component: InactiveCardPage },
              { path: 'clienti/:id/spesa', Component: PurchasePage },
              { path: 'clienti/:id/premi', Component: RedeemPage },
              { path: 'clienti/:id/movimenti', Component: MovementsPage },
              { path: 'impostazioni', Component: SettingsPage },
              { path: 'impostazioni/premi', Component: RewardsCatalogPage },
              // An operator's own till PIN, from the phone; a device goes to / (SPEC-tablet-kiosk, 7).
              { path: 'impostazioni/pin', Component: PinSettingsPage },
            ],
          },
        ],
      },
      // Component showcase, development builds only.
      ...(import.meta.env.DEV ? [{ path: 'dev/ui', Component: UiGallery }] : []),
      { path: '*', Component: NotFoundPage },
    ],
  },
];
