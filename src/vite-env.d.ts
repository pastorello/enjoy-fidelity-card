/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** '1' only in the E2E build (playwright.config.ts): installs the fake card reader. */
  readonly VITE_E2E?: string;
}
