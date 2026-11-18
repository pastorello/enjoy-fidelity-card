// SPEC-cards, point 8.6: the origin of the link written on the cards. Pure functions, shared by the app
// (cardLinkUrl.ts) and by the build check in vite.config.ts: no import.meta, no DOM.

const VARIABLE = 'VITE_CARD_LINK_ORIGIN';

/**
 * Validates an origin for the card link: `https://` only, no path, no trailing `/`, no query, fragment
 * or credentials. Every card written depends on it, so anything else is refused, not repaired.
 */
export function parseCardLinkOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${VARIABLE} is not a valid origin: "${value}"`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${VARIABLE} must use https: "${value}"`);
  }
  // The serialized origin drops path, query, fragment, credentials and default port: an exact match
  // means the value is a bare origin, written in its canonical form.
  if (url.username !== '' || url.password !== '' || url.origin !== value) {
    throw new Error(
      `${VARIABLE} must be a bare origin (https://host, no path or final /): "${value}"`,
    );
  }
  return url.origin;
}

export type CardLinkBuildEnv = {
  VERCEL_ENV?: string | undefined;
  VITE_CARD_LINK_ORIGIN?: string | undefined;
};

/**
 * Build-time check (vite.config.ts): in production (`VERCEL_ENV=production`) the variable is required
 * and must be an https origin; in previews and locally it may be missing (the app uses
 * `location.origin`), but a value that is set must still be valid.
 */
export function checkCardLinkOriginForBuild(env: CardLinkBuildEnv): void {
  const value = env.VITE_CARD_LINK_ORIGIN?.trim() ?? '';
  if (value === '') {
    if (env.VERCEL_ENV === 'production') {
      throw new Error(
        `${VARIABLE} is required in production: set it on Vercel (Production) to the final https origin of the app.`,
      );
    }
    return;
  }
  parseCardLinkOrigin(value);
}
