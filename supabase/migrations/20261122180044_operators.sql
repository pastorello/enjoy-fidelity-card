-- operators (SPEC-operators.md, "Modello dati e regole di accesso"): the Operatori screen
-- lets an admin invite, deactivate and reactivate people from the app.
--
-- This part: the new columns of app.operators and "deactivated = no access at all". A
-- deactivated profile keeps its user_id (the person can come back with the same account),
-- so every place that treated "linked to an Auth user" as "active" now also requires
-- deactivated_at is null. Found with a grep of app.operators in every migration:
--   private.current_operator_id()  (identity) -> acting_operator_id, is_active_operator,
--                                     is_admin, set_my_pin and every policy follow it
--   private.valid_cashier_id()     (tablet-kiosk) -> the cashier of a device
--   app.get_session_identity()     (tablet-kiosk) -> reads the profile by user_id itself
--   app.list_cashiers()            (tablet-kiosk) -> user_id is not null
--   app.unlock_cashier()           (tablet-kiosk) -> user_id is not null
--   private.add_operator()         (tablet-kiosk) -> relinking reactivates
-- The other references (author columns, joins for names in views and exports) are history,
-- not access, and stay as they are: a deactivated person's movements keep its name.
-- Every function keeps its signature, attributes and privileges (restated below).

-- New columns ---------------------------------------------------------------------------------
alter table app.operators
  add column deactivated_at timestamptz null,
  add column deactivated_by uuid null references app.operators (id),
  add column invited_at timestamptz null,
  add column invited_by uuid null references app.operators (id),
  add constraint operators_deactivated_check check ((deactivated_at is null) = (deactivated_by is null));

comment on column app.operators.deactivated_at is
  'null = active. Set by set_operator_active: the profile keeps its account but has no access.';
comment on column app.operators.invited_at is 'Last invite sent from the app.';

-- current_operator_id (identity): only a profile that is not deactivated ---------------------
create or replace function private.current_operator_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from app.operators
  where user_id = (select auth.uid()) and deactivated_at is null;
$$;

revoke execute on function private.current_operator_id() from public, anon;
grant execute on function private.current_operator_id() to authenticated;

-- valid_cashier_id (tablet-kiosk): a deactivated cashier is no cashier ------------------------
-- A turn opened before the deactivation stays written on the device row and gives nothing.
create or replace function private.valid_cashier_id()
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
    and o.deactivated_at is null
    and exists (select 1 from private.operator_pins p where p.operator_id = o.id);
$$;

revoke execute on function private.valid_cashier_id() from public, anon, authenticated;

-- add_operator (tablet-kiosk): relinking a profile also reactivates it ----------------------
-- Same as in 20261118145318_tablet_kiosk.sql, plus deactivated_at/_by cleared on the
-- profile it relinks ("rimettere un operatore", docs/setup-accounts.md). A new profile
-- starts active.
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
    update app.operators
    set user_id = v_user_id, role = p_role, deactivated_at = null, deactivated_by = null
    where id = v_named.id;
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

-- unlock_cashier (tablet-kiosk): a deactivated operator answers no_pin --------------------------
-- Same as in 20261118145318_tablet_kiosk.sql, plus deactivated_at is null on the operator:
-- like an operator without an account, the PIN is never checked and nothing is counted.
-- No lock on the operator row (SPEC-operators.md point 7): valid_cashier_id is the guarantee.
create or replace function app.unlock_cashier(p_operator_id uuid, p_pin text)
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
  where o.id = p_operator_id and o.user_id is not null and o.deactivated_at is null;
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

revoke execute on function app.unlock_cashier(uuid, text) from public, anon;
grant execute on function app.unlock_cashier(uuid, text) to authenticated;

-- get_session_identity (tablet-kiosk): null for a deactivated operator account ---------------
-- Same answers as in 20261118145318_tablet_kiosk.sql; a deactivated operator account gets
-- null, as an unlinked one (SPEC-operators.md Open Questions 6: no new state). An Auth user
-- is never both an operator and a device, so it is not looked up among the devices. The
-- cashier of a device follows valid_cashier_id, which already ignores deactivated ones.
create or replace function app.get_session_identity()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_operator app.operators;
  v_device app.devices;
  v_cashier app.operators;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_operator from app.operators where user_id = (select auth.uid());
  if v_operator.id is not null then
    if v_operator.deactivated_at is not null then
      return null;
    end if;
    return jsonb_build_object('kind', 'operator', 'operator', jsonb_build_object(
      'id', v_operator.id, 'name', v_operator.name, 'role', v_operator.role,
      'has_pin', exists (select 1 from private.operator_pins p where p.operator_id = v_operator.id)));
  end if;

  select * into v_device from app.devices where user_id = (select auth.uid());
  if v_device.id is null then
    return null;
  end if;

  select * into v_cashier from app.operators where id = private.valid_cashier_id();
  return jsonb_build_object(
    'kind', 'device',
    'device', jsonb_build_object('id', v_device.id, 'name', v_device.name),
    'cashier', case when v_cashier.id is null then null else jsonb_build_object(
      'id', v_cashier.id, 'name', v_cashier.name, 'role', v_cashier.role) end,
    'turn_expires_at', case when v_cashier.id is null then null
                            else v_device.cashier_since + interval '12 hours' end,
    'lock_seconds_left', case when v_device.locked_until > v_now
                              then ceil(extract(epoch from v_device.locked_until - v_now))::int
                              else 0 end);
end;
$$;

-- list_cashiers (tablet-kiosk): linked and not deactivated --------------------------------------
create or replace function app.list_cashiers()
returns table (id uuid, name text, role text, has_pin boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_device_id() is null then
    raise exception 'Only a device account can list the cashiers' using errcode = '42501';
  end if;

  return query
    select o.id, o.name, o.role,
           exists (select 1 from private.operator_pins p where p.operator_id = o.id)
    from app.operators o
    where o.user_id is not null and o.deactivated_at is null
    order by lower(o.name), o.id;
end;
$$;

revoke execute on function app.get_session_identity(), app.list_cashiers() from public, anon;
grant execute on function app.get_session_identity(), app.list_cashiers() to authenticated;
