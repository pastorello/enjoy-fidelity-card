import type { RouteObject } from 'react-router';
import { HomePage } from './HomePage';
import { NotFoundPage } from './NotFoundPage';
import { RootLayout } from './RootLayout';
import { RouteErrorBoundary } from './RouteErrorBoundary';

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
      { path: '*', Component: NotFoundPage },
    ],
  },
];
