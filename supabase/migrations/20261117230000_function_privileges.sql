-- Postgres gives EXECUTE on every new function to PUBLIC (and so to anon).
-- The schema-scoped "revoke execute on functions from public, anon" in the
-- init migration cannot remove that built-in default, so it had no effect.
-- Revoke it for every function postgres creates from now on; the explicit
-- per-schema defaults (app: authenticated and service_role; public: the
-- Supabase API roles) still apply, and private functions need explicit grants.
alter default privileges for role postgres revoke execute on functions from public;

-- Functions created before this migration.
revoke execute on function private.enable_rls_on_new_app_tables() from public;
