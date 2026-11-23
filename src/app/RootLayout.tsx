import { Navigate, Outlet, useLocation } from 'react-router';

/** The links of Auth emails that open the public /imposta-password page. */
const LINK_TYPES = new Set(['recovery', 'invite']);

/**
 * Fallback for a recovery or invite link sent to site_url: when Supabase drops a redirectTo that
 * is not in its allow list, the email points to `/?token_hash=…&type=recovery` (or `type=invite`,
 * with the invite's texts in the fragment). Forward it to the public /imposta-password page, query
 * and fragment kept, before RequireAuth sends it to /accedi.
 */
function isFallbackLink(pathname: string, search: string): boolean {
  if (pathname !== '/') return false;
  const params = new URLSearchParams(search);
  return LINK_TYPES.has(params.get('type') ?? '') && Boolean(params.get('token_hash'));
}

export function RootLayout() {
  const { pathname, search, hash } = useLocation();
  if (isFallbackLink(pathname, search)) {
    return <Navigate to={{ pathname: '/imposta-password', search, hash }} replace />;
  }
  return <Outlet />;
}
