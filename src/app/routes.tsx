import type { RouteObject } from 'react-router';
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
      { index: true, Component: HomePage },
      // Component showcase, development builds only.
      ...(import.meta.env.DEV ? [{ path: 'dev/ui', Component: UiGallery }] : []),
      { path: '*', Component: NotFoundPage },
    ],
  },
];
