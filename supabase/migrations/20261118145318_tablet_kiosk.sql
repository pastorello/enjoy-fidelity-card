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

-- Access helpers extended to the cashier --------------------------------------------------
-- An operator account acts as itself, exactly as before. A device account acts as
-- its cashier only while the turn is valid: a cashier is set, the unlock is less
-- than 12 hours old, and that operator still has an account and a PIN. Otherwise
-- a device is nobody: every policy hides every row and every write RPC refuses it
-- with the code its module already uses for "no operator".

-- valid_cashier_id: the cashier of the caller's device while the turn is valid.
-- Only the security definer helpers below call it (as their owner).
create function private.valid_cashier_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.cashier_operator_id
  from app.devices d
  join app.operators o on o.id = d.cashier_operator_id
  where d.user_id = (select auth.uid())
    and d.cashier_since > now() - interval '12 hours'
    and o.user_id is not null
    and exists (select 1 from private.operator_pins p where p.operator_id = o.id);
$$;

revoke execute on function private.valid_cashier_id() from public, anon, authenticated;

-- Same signature and attributes as in ledger (the last redefinition before this one).
create or replace function private.acting_operator_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_operator_id(), private.valid_cashier_id());
$$;

revoke execute on function private.acting_operator_id() from public, anon, authenticated;

-- Same signatures and attributes as in identity. For an operator account the
-- answer is unchanged: user_id is unique, so "a profile linked to me exists" and
-- "current_operator_id() is not null" are the same question.
create or replace function private.is_active_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.acting_operator_id() is not null;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.operators where id = private.acting_operator_id() and role = 'admin'
  );
$$;

-- create or replace keeps the existing ACL; restated so this file alone shows it.
revoke execute on function private.is_active_operator(), private.is_admin() from public, anon;
grant execute on function private.is_active_operator(), private.is_admin() to authenticated;

-- Kiosk RPCs: PIN, unlock, end of the turn ---------------------------------------------------
-- Every PIN check runs here, never in the client. Wrong PINs are counted per device:
-- the 5th in a row locks the device for 5 minutes, and while locked no PIN is even
-- checked. unlock_cashier answers with jsonb instead of raising, so the incremented
-- counter is committed with the answer (an exception would roll it back).

-- set_my_pin: the caller's own PIN, never someone else's. A new PIN closes the
-- caller's open turns on every tablet. No old PIN: the phone session is personal.
create function app.set_my_pin(p_pin text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := private.current_operator_id();
begin
  -- A device has no operator profile, so current_operator_id() is null for it too.
  if v_operator_id is null or private.current_device_id() is not null then
    raise exception 'Only an operator account can set its own PIN' using errcode = '42501';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'The PIN must be 4 digits' using errcode = '22023';
  end if;

  insert into private.operator_pins (operator_id, pin_hash, updated_at)
  values (v_operator_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), now())
  on conflict (operator_id) do update
    set pin_hash = excluded.pin_hash, updated_at = excluded.updated_at;

  update app.devices
  set cashier_operator_id = null, cashier_since = null
  where cashier_operator_id = v_operator_id;
end;
$$;

-- unlock_cashier: the device row is locked first (for update), so concurrent
-- attempts from the same tablet are counted one after the other and cannot slip
-- past the 5th. Time is read after the row lock (clock_timestamp, not the
-- transaction start), so an attempt that waited for another one sees the lock that
-- one set and never reports more than 300 seconds left. Order: caller, input,
-- lock, operator, PIN.
create function app.unlock_cashier(p_operator_id uuid, p_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device app.devices;
  v_operator app.operators;
  v_hash text;
  v_attempts int;
  v_now timestamptz;
begin
  select * into v_device from app.devices
  where user_id = (select auth.uid())
  for update;
  if v_device.id is null then
    raise exception 'Only a device account can unlock a cashier' using errcode = '42501';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'The PIN must be 4 digits' using errcode = '22023';
  end if;
  v_now := clock_timestamp();

  if v_device.locked_until > v_now then
    return jsonb_build_object(
      'status', 'locked',
      'lock_seconds_left', ceil(extract(epoch from v_device.locked_until - v_now))::int);
  end if;

  select o.* into v_operator from app.operators o
  where o.id = p_operator_id and o.user_id is not null;
  -- for share: a concurrent set_my_pin either waits for this unlock (and then closes
  -- the turn it opens) or commits first (and this check reads the new hash).
  select p.pin_hash into v_hash from private.operator_pins p
  where p.operator_id = v_operator.id
  for share;
  if v_hash is null then
    return jsonb_build_object('status', 'no_pin');
  end if;

  if v_hash is distinct from extensions.crypt(p_pin, v_hash) then
    v_attempts := v_device.failed_pin_attempts + 1;
    if v_attempts >= 5 then
      update app.devices
      set failed_pin_attempts = 0, locked_until = v_now + interval '5 minutes'
      where id = v_device.id;
      return jsonb_build_object('status', 'locked', 'lock_seconds_left', 300);
    end if;
    update app.devices set failed_pin_attempts = v_attempts where id = v_device.id;
    return jsonb_build_object('status', 'wrong_pin', 'attempts_left', 5 - v_attempts);
  end if;

  update app.devices
  set cashier_operator_id = v_operator.id, cashier_since = v_now,
      failed_pin_attempts = 0, locked_until = null
  where id = v_device.id;
  return jsonb_build_object(
    'status', 'ok',
    'cashier', jsonb_build_object('id', v_operator.id, 'name', v_operator.name, 'role', v_operator.role),
    'turn_expires_at', v_now + interval '12 hours');
end;
$$;

-- end_cashier_turn: the caller's device has no cashier any more. The counter of
-- wrong PINs and a running lock stay as they are.
create function app.end_cashier_turn()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device_id uuid := private.current_device_id();
begin
  if v_device_id is null then
    raise exception 'Only a device account can end a cashier turn' using errcode = '42501';
  end if;
  update app.devices
  set cashier_operator_id = null, cashier_since = null
  where id = v_device_id;
end;
$$;

revoke execute on function app.set_my_pin(text), app.unlock_cashier(uuid, text), app.end_cashier_turn()
  from public, anon;
grant execute on function app.set_my_pin(text), app.unlock_cashier(uuid, text), app.end_cashier_turn()
  to authenticated;
