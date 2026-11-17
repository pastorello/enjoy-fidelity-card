import { Navigate, Outlet, useLocation } from 'react-router';

/**
 * Fallback for a recovery link sent to site_url: when Supabase drops a redirectTo that is not
 * in its allow list, the email points to `/?token_hash=…&type=recovery`. Forward it to the
 * public /imposta-password page, query kept, before RequireAuth sends it to /accedi.
 */
function isFallbackRecoveryLink(pathname: string, search: string): boolean {
  if (pathname !== '/') return false;
  const params = new URLSearchParams(search);
  return params.get('type') === 'recovery' && Boolean(params.get('token_hash'));
}

export function RootLayout() {
  const { pathname, search, hash } = useLocation();
  if (isFallbackRecoveryLink(pathname, search)) {
    return <Navigate to={{ pathname: '/imposta-password', search, hash }} replace />;
  }
  return <Outlet />;
}
