/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Bare https origin of the card links (SPEC-cards 8.6); empty → location.origin. */
  readonly VITE_CARD_LINK_ORIGIN?: string;
  /** '1' only in the E2E build (playwright.config.ts): installs the fake card reader. */
  readonly VITE_E2E?: string;
}
