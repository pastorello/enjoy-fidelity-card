-- operators: administrators from the till tablet with the cashier's PIN asked again
-- (SPEC-operators.md points 5 and 7, Open Questions 11; owner's answer of 2026-11-23,
-- brain/DECISIONS.md). Until now a device never invited, named or reactivated an admin (EO005).
-- Now it may, but only when the admin cashier types their PIN again, and the PIN is checked here,
-- in the same transaction as the action, against private.operator_pins with the counter and the
-- lock of unlock_cashier: the 5th wrong PIN in a row (wherever it was typed: /cassa or an admin
-- action) locks the device for 5 minutes, and while locked no PIN is checked at all.
--
-- Why a PIN and not just the turn: the turn lasts 12 hours without an idle timeout, so whoever
-- finds the tablet unlocked by an owner would otherwise get a permanent admin account. A wrong PIN
-- must stay counted, so the PIN check answers in jsonb and never raises (an exception would roll
-- the counter back): that is why the role and the activation with a PIN are new RPCs that answer
-- in jsonb, next to the old ones, which keep their shape and still refuse an admin action from a
-- device (EO005, now "the PIN is missing"). operator_invite_begin already answers in jsonb and
-- takes the PIN as a fifth argument (default null). A phone session never sends a PIN (22023).
--
-- The PIN is never written anywhere but compared with crypt(); the Edge Function passes it to
-- operator_invite_begin and never stores it in private.operator_invites.
--
-- Lock order: the with_pin RPCs lock the operator rows (lock_operator_target) and then the
-- device row, the same order as a deactivation (operators, then devices); unlock_cashier and
-- set_my_pin lock devices and then the PIN row, and so does the check: no cycle.

-- check_cashier_pin: null when the PIN of the device's cashier is right, otherwise the answer
-- to give ({status: 'wrong_pin', attempts_left} or {status: 'locked', lock_seconds_left}), with
-- the counter of wrong PINs updated as unlock_cashier does. Raises 22023 when the caller is not a
-- device (a phone session is never asked a PIN) or the PIN is not 4 digits, EO005 when the PIN is
-- missing, 42501 when the device has no valid cashier with a PIN. Callers check their own rights
-- first, so a caller who may not act never touches the counter.
create function private.check_cashier_pin(p_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device app.devices;
  v_cashier_id uuid;
  v_hash text;
  v_attempts int;
  v_now timestamptz;
begin
  select * into v_device from app.devices
  where user_id = (select auth.uid())
  for update;
  if v_device.id is null then
    raise exception 'The PIN is asked only on a device' using errcode = '22023';
  end if;
  if p_pin is null then
    raise exception 'From a device an admin needs the cashier''s PIN' using errcode = 'EO005';
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'The PIN must be 4 digits' using errcode = '22023';
  end if;
  -- After the row lock, as unlock_cashier: an attempt that waited sees the lock just set.
  v_now := clock_timestamp();

  if v_device.locked_until > v_now then
    return jsonb_build_object(
      'status', 'locked',
      'lock_seconds_left', ceil(extract(epoch from v_device.locked_until - v_now))::int);
  end if;

  v_cashier_id := private.valid_cashier_id();
  if v_cashier_id is null then
    raise exception 'The device has no cashier' using errcode = '42501';
  end if;
  select p.pin_hash into v_hash from private.operator_pins p
  where p.operator_id = v_cashier_id
  for share;
  if v_hash is null then
    raise exception 'The cashier has no PIN' using errcode = '42501';
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

  update app.devices set failed_pin_attempts = 0, locked_until = null where id = v_device.id;
  return null;
end;
$$;

revoke execute on function private.check_cashier_pin(text) from public, anon, authenticated;

-- The writes of set_operator_role / _active, shared with their with_pin versions. The target is
-- already locked and checked (lock_operator_target); same value -> nothing written.
create function private.write_operator_role(p_target app.operators, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_target.role <> p_role then
    if p_role = 'operator' then
      perform private.assert_other_admin(p_target);
    end if;
    update app.operators o set role = p_role where o.id = p_target.id;
  end if;
end;
$$;

revoke execute on function private.write_operator_role(app.operators, text)
  from public, anon, authenticated;

create function private.write_operator_active(p_target app.operators, p_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_active and p_target.deactivated_at is not null then
    update app.operators o set deactivated_at = null, deactivated_by = null where o.id = p_target.id;
  elsif not p_active and p_target.deactivated_at is null then
    perform private.assert_other_admin(p_target);
    update app.operators o
    set deactivated_at = now(), deactivated_by = private.acting_operator_id()
    where o.id = p_target.id;
    update app.devices d set cashier_operator_id = null, cashier_since = null
    where d.cashier_operator_id = p_target.id;
  end if;
end;
$$;

revoke execute on function private.write_operator_active(app.operators, boolean)
  from public, anon, authenticated;

-- set_operator_role / set_operator_active: signature, answer and privileges unchanged. From a
-- device, naming an admin or reactivating a deactivated admin goes through the with_pin
-- versions; here it stays EO005 (the PIN is missing).
create or replace function app.set_operator_role(p_operator_id uuid, p_role text)
returns table (
  id uuid, name text, role text, status text, email text, has_pin boolean, is_me boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target app.operators;
begin
  v_target := private.lock_operator_target(p_operator_id);
  if p_role is null or p_role not in ('admin', 'operator') then
    raise exception 'The role must be admin or operator' using errcode = '22023';
  end if;
  if p_role = 'admin' and private.current_device_id() is not null then
    raise exception 'From a device an admin is named only with the cashier''s PIN'
      using errcode = 'EO005';
  end if;
  perform private.write_operator_role(v_target, p_role);
  return query select * from private.operator_rows(v_target.id);
end;
$$;

create or replace function app.set_operator_active(p_operator_id uuid, p_active boolean)
returns table (
  id uuid, name text, role text, status text, email text, has_pin boolean, is_me boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target app.operators;
begin
  v_target := private.lock_operator_target(p_operator_id);
  if p_active is null then
    raise exception 'active must be true or false' using errcode = '22023';
  end if;
  if p_active and v_target.deactivated_at is not null and v_target.role = 'admin'
     and private.current_device_id() is not null then
    raise exception 'From a device an admin is reactivated only with the cashier''s PIN'
      using errcode = 'EO005';
  end if;
  perform private.write_operator_active(v_target, p_active);
  return query select * from private.operator_rows(v_target.id);
end;
$$;

revoke execute on function app.set_operator_role(uuid, text), app.set_operator_active(uuid, boolean)
  from public, anon;
grant execute on function app.set_operator_role(uuid, text), app.set_operator_active(uuid, boolean)
  to authenticated;

-- set_operator_role_with_pin / set_operator_active_with_pin: the same change from a device, with
-- the cashier's PIN checked on every call (whatever the change), after the rights and the input
-- (a caller who may not act never touches the counter). Answers {status: 'ok', operator: <the
-- row of list_operators>}, or the answer of check_cashier_pin with nothing changed. The errors of
-- set_operator_role / _active, plus 22023 from a phone session and EO005 without a PIN.
create function app.set_operator_role_with_pin(p_operator_id uuid, p_role text, p_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target app.operators;
  v_refused jsonb;
begin
  v_target := private.lock_operator_target(p_operator_id);
  if p_role is null or p_role not in ('admin', 'operator') then
    raise exception 'The role must be admin or operator' using errcode = '22023';
  end if;
  v_refused := private.check_cashier_pin(p_pin);
  if v_refused is not null then
    return v_refused;
  end if;
  perform private.write_operator_role(v_target, p_role);
  return jsonb_build_object('status', 'ok',
    'operator', (select to_jsonb(r) from private.operator_rows(v_target.id) r));
end;
$$;

create function app.set_operator_active_with_pin(p_operator_id uuid, p_active boolean, p_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target app.operators;
  v_refused jsonb;
begin
  v_target := private.lock_operator_target(p_operator_id);
  if p_active is null then
    raise exception 'active must be true or false' using errcode = '22023';
  end if;
  v_refused := private.check_cashier_pin(p_pin);
  if v_refused is not null then
    return v_refused;
  end if;
  perform private.write_operator_active(v_target, p_active);
  return jsonb_build_object('status', 'ok',
    'operator', (select to_jsonb(r) from private.operator_rows(v_target.id) r));
end;
$$;

revoke execute on function app.set_operator_role_with_pin(uuid, text, text),
  app.set_operator_active_with_pin(uuid, boolean, text) from public, anon;
grant execute on function app.set_operator_role_with_pin(uuid, text, text),
  app.set_operator_active_with_pin(uuid, boolean, text) to authenticated;

-- operator_invite_begin: restated whole from 20261122180044_operators.sql with the PIN as a fifth
-- argument. From a device, an admin (or any invite that carries a PIN) is checked with
-- check_cashier_pin before anything is reserved: a wrong PIN or the lock answer as data
-- (wrong_pin {attempts_left}, locked {lock_seconds_left}) and reserve nothing; a retry of the
-- same operation asks the PIN again. EO005 when the PIN is missing on a device, 22023 when a
-- phone session sends one. The PIN is never written to private.operator_invites.
drop function app.operator_invite_begin(uuid, text, text, text);

create function app.operator_invite_begin(
  p_operation_id uuid, p_name text, p_email text, p_role text, p_pin text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_requested_by uuid;
  v_name text := private.clean_name(p_name);
  v_email text := lower(btrim(p_email));
  v_invite private.operator_invites;
  v_inserted uuid;
  v_user auth.users;
  v_operator app.operators;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can invite' using errcode = '42501';
  end if;
  v_requested_by := private.acting_operator_id();
  if p_operation_id is null
     or v_name is null or length(v_name) not between 1 and 60
     or v_email is null or length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_role is null or p_role not in ('admin', 'operator') then
    raise exception 'Invalid invite' using errcode = '22023';
  end if;
  if private.current_device_id() is not null then
    if p_role = 'admin' or p_pin is not null then
      v_result := private.check_cashier_pin(p_pin);
      if v_result is not null then
        return v_result;
      end if;
    end if;
  elsif p_pin is not null then
    raise exception 'The PIN is asked only on a device' using errcode = '22023';
  end if;

  -- Another operation that stopped halfway (pending for more than 2 minutes) frees the email
  -- and the name.
  update private.operator_invites i
  set status = 'failed', updated_at = now()
  where i.status = 'pending' and i.operation_id <> p_operation_id
    and (lower(i.email) = v_email or lower(i.name) = lower(v_name))
    and i.updated_at < now() - interval '2 minutes';

  begin
    insert into private.operator_invites
      (operation_id, requested_by, name, email, role, status, existing_user)
    values (p_operation_id, v_requested_by, v_name, v_email, p_role, 'pending', false)
    on conflict (operation_id) do nothing
    returning operation_id into v_inserted;
  exception when unique_violation then
    return jsonb_build_object('status', 'in_progress');
  end;

  select * into v_invite from private.operator_invites i
  where i.operation_id = p_operation_id
  for update;
  if v_invite.name <> v_name or v_invite.email <> v_email or v_invite.role <> p_role
     or v_invite.requested_by <> v_requested_by then
    raise exception 'Operation % was reserved with other data', p_operation_id using errcode = '22023';
  end if;

  if v_inserted is null then
    if v_invite.status = 'done' then
      return jsonb_build_object('status', 'done', 'operator', private.operator_brief(v_invite.operator_id));
    end if;
    if v_invite.status = 'pending' and v_invite.updated_at >= now() - interval '2 minutes' then
      return jsonb_build_object('status', 'in_progress');
    end if;
    begin
      update private.operator_invites i set status = 'pending', updated_at = now()
      where i.operation_id = p_operation_id;
    exception when unique_violation then
      return jsonb_build_object('status', 'in_progress');
    end;
  end if;

  -- The email: a device, a profile (active, invited or deactivated), or an Auth user that is
  -- neither (reused: _finish links it).
  select * into v_user from auth.users u where lower(u.email) = v_email
  order by u.created_at, u.id limit 1;
  if v_user.id is not null then
    if exists (select 1 from app.devices d where d.user_id = v_user.id) then
      v_result := jsonb_build_object('status', 'email_is_device');
    else
      select * into v_operator from app.operators o where o.user_id = v_user.id;
      if v_operator.id is not null then
        v_result := jsonb_build_object(
          'status', 'email_taken', 'deactivated', v_operator.deactivated_at is not null);
      end if;
    end if;
  end if;
  if v_result is null and exists (
    select 1 from app.operators o where lower(o.name) = lower(v_name) and o.user_id is not null
  ) then
    v_result := jsonb_build_object('status', 'name_taken');
  end if;
  if v_result is not null then
    update private.operator_invites i set status = 'failed', updated_at = now()
    where i.operation_id = p_operation_id;
    return v_result;
  end if;

  update private.operator_invites i set existing_user = v_user.id is not null
  where i.operation_id = p_operation_id;
  v_result := jsonb_build_object(
    'status', 'proceed',
    'invited_by_name', (select o.name from app.operators o where o.id = v_requested_by));
  if v_user.id is not null then
    v_result := v_result || jsonb_build_object(
      'existing_user_id', v_user.id,
      'existing_confirmed', v_user.email_confirmed_at is not null,
      'existing_has_password', coalesce(v_user.encrypted_password, '') <> '');
  end if;
  return v_result;
end;
$$;

revoke execute on function app.operator_invite_begin(uuid, text, text, text, text) from public, anon;
grant execute on function app.operator_invite_begin(uuid, text, text, text, text) to authenticated;
