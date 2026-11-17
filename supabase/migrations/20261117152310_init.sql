-- Initial platform schema: application schema `app` with row level security
-- enabled automatically on every new table (see SPEC-platform.md §8).

create extension if not exists pgcrypto with schema extensions;

-- Application data lives in `app`. Only signed-in users may use it; access to
-- rows is always decided by RLS policies.
create schema app;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated, service_role;

alter default privileges in schema app
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema app
  grant all on tables to service_role;
alter default privileges in schema app
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema app
  revoke execute on functions from public, anon;
alter default privileges in schema app
  grant execute on functions to authenticated, service_role;

-- Internal helpers, never exposed through the API.
create schema private;
revoke all on schema private from public, anon, authenticated;

create function private.enable_rls_on_new_app_tables()
returns event_trigger
language plpgsql
set search_path = ''
as $$
declare
  obj record;
begin
  for obj in
    select object_identity
    from pg_event_trigger_ddl_commands()
    where object_type = 'table' and schema_name = 'app'
  loop
    execute format('alter table %s enable row level security', obj.object_identity);
  end loop;
end;
$$;

create event trigger enable_rls_on_new_app_tables
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function private.enable_rls_on_new_app_tables();
