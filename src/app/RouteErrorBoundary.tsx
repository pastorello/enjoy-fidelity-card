import { useRouteError } from 'react-router';
import { ErrorScreen } from './ErrorScreen';

export function RouteErrorBoundary() {
  // Logged for developers only; the user never sees technical details.
  console.error(useRouteError());
  return <ErrorScreen onRetry={() => window.location.reload()} />;
}
