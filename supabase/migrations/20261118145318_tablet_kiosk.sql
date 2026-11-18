-- tablet-kiosk (SPEC-tablet-kiosk.md, "Modello dati e regole di accesso"): device
-- accounts for the shared tablet at the till, the operators' PIN hashes, and the
-- manual add_device procedure. An Auth user is either an operator or a device,
-- never both: add_device and add_operator refuse each other's users.

-- Devices ------------------------------------------------------------------------------
-- One row per shared tablet. The cashier chosen with a PIN lives on the device
-- row. Never reachable through the API: RLS without policies and no privilege
-- for anon/authenticated; only security definer functions read or write it.
-- user_id is cleared when the Auth user is deleted: the device stays, unlinked,
-- and nobody can act as its cashier any more.
create table app.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  name text not null check (name = btrim(name) and length(name) between 1 and 60),
  cashier_operator_id uuid references app.operators (id),
  cashier_since timestamptz,
  failed_pin_attempts int not null default 0 check (failed_pin_attempts between 0 and 4),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  constraint devices_cashier_check check ((cashier_operator_id is null) = (cashier_since is null))
);

comment on table app.devices is
  'Shared tablets (device accounts). user_id null = account removed. Not exposed by the API.';

create unique index devices_name_key on app.devices (lower(name));
create index devices_cashier_operator_id_idx on app.devices (cashier_operator_id);

-- The event trigger of the init migration already enabled RLS; stated here too
-- because this table must never be readable without a security definer function.
alter table app.devices enable row level security;
revoke all on app.devices from public, anon, authenticated;

-- Operator PINs --------------------------------------------------------------------------
-- Only the bcrypt hash (extensions.crypt(pin, extensions.gen_salt('bf', 8))),
-- never the PIN. Outside the API schema and with no privilege for any API role.
create table private.operator_pins (
  operator_id uuid primary key references app.operators (id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

comment on table private.operator_pins is
  'bcrypt hashes of the operators'' 4-digit till PINs. Never the PIN in clear.';

alter table private.operator_pins enable row level security;
revoke all on private.operator_pins from public, anon, authenticated;

-- current_device_id ------------------------------------------------------------------------
-- Like current_operator_id: only ever answers for the calling user.
create function private.current_device_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from app.devices where user_id = (select auth.uid());
$$;

revoke execute on function private.current_device_id() from public, anon;
grant execute on function private.current_device_id() to authenticated;

-- add_device --------------------------------------------------------------------------------
-- Links the Auth user with this email to a device: relinks the device with the
-- same name (a tablet whose account was recreated) or creates a new one. Refuses
-- a user linked to an operator. Run as postgres from the SQL Editor; no API role
-- may execute it. The Auth user row is locked so a concurrent add_operator for
-- the same user waits and then sees this link.
create function private.add_device(p_email text, p_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_name text := btrim(p_name);
  v_linked app.devices;
  v_named app.devices;
begin
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email)) for update;
  if v_user_id is null then
    raise exception 'No Auth user with email %: create it first in Authentication > Users', p_email;
  end if;

  if exists (select 1 from app.operators where user_id = v_user_id) then
    raise exception 'Account % is linked to an operator: a device needs its own account', p_email;
  end if;

  select * into v_linked from app.devices where user_id = v_user_id;
  select * into v_named from app.devices where lower(name) = lower(v_name);

  if v_linked.id is not null and v_linked.id is distinct from v_named.id then
    raise exception 'Account % is already linked to device "%"', p_email, v_linked.name;
  end if;
  if v_named.user_id is not null and v_named.user_id <> v_user_id then
    raise exception 'Device "%" is linked to another account', v_named.name;
  end if;

  if v_named.id is not null then
    update app.devices set user_id = v_user_id where id = v_named.id;
    return v_named.id;
  end if;

  insert into app.devices (user_id, name)
  values (v_user_id, v_name)
  returning id into v_named.id;
  return v_named.id;
end;
$$;

revoke execute on function private.add_device(text, text)
  from public, anon, authenticated, service_role;

-- add_operator (identity), now refusing a device user ---------------------------------------
-- Same signature and behaviour as in 20261117202951_identity.sql, plus the
-- device check and the same lock on the Auth user row as add_device.
create or replace function private.add_operator(p_email text, p_name text, p_role text)
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
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email)) for update;
  if v_user_id is null then
    raise exception 'No Auth user with email %: create it first in Authentication > Users', p_email;
  end if;

  if exists (select 1 from app.devices where user_id = v_user_id) then
    raise exception 'Account % is linked to a device: an operator needs its own account', p_email;
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

-- create or replace keeps the existing ACL; restated so this file alone shows it.
revoke execute on function private.add_operator(text, text, text)
  from public, anon, authenticated, service_role;
