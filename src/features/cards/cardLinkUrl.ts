import { parseCardLinkOrigin } from './cardLinkOrigin';

/** The secret of the link: 16 random bytes in base64url (issue_card_link), never the uid. */
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** The configured origin when set (validated, never repaired), otherwise the page's own origin. */
export function resolveCardLinkOrigin(configured: string | undefined, fallback: string): string {
  const value = configured?.trim() ?? '';
  return value === '' ? fallback : parseCardLinkOrigin(value);
}

/** cardLinkUrl(token) → "https://<origin>/s/<token>": the only content ever written on a card. */
export function cardLinkUrl(token: string): string {
  if (!TOKEN.test(token)) {
    throw new RangeError('cardLinkUrl: the token must be 22 base64url characters');
  }
  const origin = resolveCardLinkOrigin(
    import.meta.env.VITE_CARD_LINK_ORIGIN,
    window.location.origin,
  );
  return `${origin}/s/${token}`;
}
