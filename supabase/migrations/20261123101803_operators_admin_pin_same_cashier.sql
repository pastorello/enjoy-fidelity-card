-- operators: the PIN asked again on the till tablet is the PIN of the admin whose rights were
-- checked (SPEC-operators.md point 7, Open Questions 11; 20261123092919_operators_admin_pin_from_device.sql).
--
-- The race: the with_pin RPCs and operator_invite_begin check the rights (is_admin, the self
-- check EO002) with the cashier of that moment, then check_cashier_pin waits on the device row
-- while an unlock_cashier of another person holds it. Once that unlock commits, the check read
-- the NEW cashier: an operator who knew only their own PIN could make someone an admin (or
-- themselves, past EO002) with the rights of the admin who was at the till a moment before.
--
-- Now check_cashier_pin takes the operator who passed the rights check (acting_operator_id()
-- right after lock_operator_target, or the requested_by of the invite) and, after the device row
-- lock, refuses with 42501 when the cashier is no longer that operator or no longer an admin,
-- before any PIN is compared or counted. The with_pin RPCs repeat the self check (EO002) with that
-- same operator. Lock order unchanged (operators, then devices): the device row is not locked
-- earlier, which would invert the order of a deactivation.

drop function private.check_cashier_pin(text);

create function private.check_cashier_pin(p_pin text, p_expected_operator_id uuid)
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
  -- After the row lock, a later statement: it sees the cashier an unlock_cashier that held the
  -- row has just committed. The PIN must be the one of the operator who passed the rights check,
  -- still an admin: otherwise 42501, before any PIN is compared or counted.
  v_cashier_id := private.valid_cashier_id();
  if v_cashier_id is null then
    raise exception 'The device has no cashier' using errcode = '42501';
  end if;
  if p_expected_operator_id is null or v_cashier_id <> p_expected_operator_id
     or not private.is_admin() then
    raise exception 'The cashier changed since the rights were checked' using errcode = '42501';
  end if;
  -- After the row lock, as unlock_cashier: an attempt that waited sees the lock just set.
  v_now := clock_timestamp();

  if v_device.locked_until > v_now then
    return jsonb_build_object(
      'status', 'locked',
      'lock_seconds_left', ceil(extract(epoch from v_device.locked_until - v_now))::int);
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

revoke execute on function private.check_cashier_pin(text, uuid) from public, anon, authenticated;

-- The with_pin RPCs: answers and errors unchanged; the PIN checked is the acting admin's.
create or replace function app.set_operator_role_with_pin(p_operator_id uuid, p_role text, p_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target app.operators;
  v_refused jsonb;
  v_acting uuid;
begin
  v_target := private.lock_operator_target(p_operator_id);
  v_acting := private.acting_operator_id();
  if p_role is null or p_role not in ('admin', 'operator') then
    raise exception 'The role must be admin or operator' using errcode = '22023';
  end if;
  -- The self check again with the operator the PIN is checked for.
  if v_target.id = v_acting then
    raise exception 'Nobody can change their own account from here' using errcode = 'EO002';
  end if;
  v_refused := private.check_cashier_pin(p_pin, v_acting);
  if v_refused is not null then
    return v_refused;
  end if;
  perform private.write_operator_role(v_target, p_role);
  return jsonb_build_object('status', 'ok',
    'operator', (select to_jsonb(r) from private.operator_rows(v_target.id) r));
end;
$$;

create or replace function app.set_operator_active_with_pin(p_operator_id uuid, p_active boolean, p_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target app.operators;
  v_refused jsonb;
  v_acting uuid;
begin
  v_target := private.lock_operator_target(p_operator_id);
  v_acting := private.acting_operator_id();
  if p_active is null then
    raise exception 'active must be true or false' using errcode = '22023';
  end if;
  -- The self check again with the operator the PIN is checked for.
  if v_target.id = v_acting then
    raise exception 'Nobody can change their own account from here' using errcode = 'EO002';
  end if;
  v_refused := private.check_cashier_pin(p_pin, v_acting);
  if v_refused is not null then
    return v_refused;
  end if;
  perform private.write_operator_active(v_target, p_active);
  return jsonb_build_object('status', 'ok',
    'operator', (select to_jsonb(r) from private.operator_rows(v_target.id) r));
end;
$$;

-- operator_invite_begin: restated whole from 20261123092919_operators_admin_pin_from_device.sql;
-- the PIN checked is the one of v_requested_by, the admin of the rights check.
create or replace function app.operator_invite_begin(
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
      v_result := private.check_cashier_pin(p_pin, v_requested_by);
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
