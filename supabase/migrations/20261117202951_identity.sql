-- identity V1 (SPEC-identity.md): operator profiles linked to Auth users, the
-- access helpers every module's RLS policies use, and add_operator, the manual
-- procedure run from the Supabase SQL Editor. Accounts are created by hand in
-- the dashboard: there is no sign-up, invite or email flow.

-- One profile per person working at the bar. The id is the profile's own, so
-- movements can reference it forever; user_id is cleared when the Auth user is
-- deleted from the dashboard, which removes access but keeps the name.
create table app.operators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  name text not null check (name = btrim(name) and length(name) between 1 and 60),
  role text not null check (role in ('admin', 'operator')),
  created_at timestamptz not null default now()
);

comment on table app.operators is
  'People working at the bar. user_id null = account removed; the profile stays for history.';

create unique index operators_name_key on app.operators (lower(name));

-- Profiles are written only by add_operator, never through the API.
revoke insert, update, delete, truncate on app.operators from authenticated;

-- Access helpers ------------------------------------------------------------
-- security definer so policies can read operators without recursing into its
-- own RLS. They only ever answer for the calling user (auth.uid()).

create function private.current_operator_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from app.operators where user_id = (select auth.uid());
$$;

create function private.is_active_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.operators where user_id = (select auth.uid()));
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.operators where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Policies run with the caller's privileges, so signed-in users need to reach
-- these helpers. Schema private is still not exposed by the API.
grant usage on schema private to authenticated;
revoke execute on function
  private.current_operator_id(), private.is_active_operator(), private.is_admin()
  from public, anon;
grant execute on function
  private.current_operator_id(), private.is_active_operator(), private.is_admin()
  to authenticated;

create policy operators_select_for_active_operators
  on app.operators
  for select
  to authenticated
  using ((select private.is_active_operator()));

-- add_operator ----------------------------------------------------------------
-- Links the Auth user with this email to a profile: relinks the profile with
-- the same name (a person coming back) or creates a new one. Run as postgres
-- from the SQL Editor; no API role may execute it.

create function private.add_operator(p_email text, p_name text, p_role text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_name text := btrim(p_name);
  v_linked app.operators;
  v_named app.operators;
begin
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'No Auth user with email %: create it first in Authentication > Users', p_email;
  end if;

  select * into v_linked from app.operators where user_id = v_user_id;
  select * into v_named from app.operators where lower(name) = lower(v_name);

  if v_linked.id is not null and v_linked.id is distinct from v_named.id then
    raise exception 'Account % is already linked to operator "%"', p_email, v_linked.name;
  end if;
  if v_named.user_id is not null and v_named.user_id <> v_user_id then
    raise exception 'Operator "%" is linked to another account', v_named.name;
  end if;

  if v_named.id is not null then
    update app.operators set user_id = v_user_id, role = p_role where id = v_named.id;
    return v_named.id;
  end if;

  insert into app.operators (user_id, name, role)
  values (v_user_id, v_name, p_role)
  returning id into v_named.id;
  return v_named.id;
end;
$$;

revoke execute on function private.add_operator(text, text, text)
  from public, anon, authenticated, service_role;
