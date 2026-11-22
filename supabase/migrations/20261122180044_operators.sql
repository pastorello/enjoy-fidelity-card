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

-- Operators screen: list, role, deactivation (SPEC-operators.md points 2 and 7) ----------------
-- One row per profile of a person (devices live in app.devices and never appear), with a
-- status computed here. "Invite accepted" = email confirmed AND a password: verifyOtp of the
-- invite confirms the email before the password is saved, and whoever stops between the two
-- steps stays invited. The same rule counts the admins for EO001. Never a PIN hash or a token.
create function private.operator_rows(p_operator_id uuid)
returns table (
  id uuid, name text, role text, status text, email text, has_pin boolean, is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.role,
         case
           when o.user_id is null then 'removed'
           when o.deactivated_at is not null then 'deactivated'
           when u.email_confirmed_at is not null and coalesce(u.encrypted_password, '') <> '' then 'active'
           else 'invited'
         end,
         case when o.user_id is null then null else u.email end,
         exists (select 1 from private.operator_pins p where p.operator_id = o.id),
         (o.id = private.acting_operator_id()) is true
  from app.operators o
  left join auth.users u on u.id = o.user_id
  where p_operator_id is null or o.id = p_operator_id
  order by (o.user_id is null or o.deactivated_at is not null), lower(o.name), o.id;
$$;

revoke execute on function private.operator_rows(uuid) from public, anon, authenticated;

-- list_operators: admins only (an admin account, or a device with an admin cashier).
create function app.list_operators()
returns table (
  id uuid, name text, role text, status text, email text, has_pin boolean, is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only an admin can list the operators' using errcode = '42501';
  end if;
  return query select * from private.operator_rows(null);
end;
$$;

-- The checks shared by set_operator_role and set_operator_active, after the lock. Locks the
-- target and every active admin, always by id, so two admins acting at the same time queue up
-- instead of deadlocking; the checks run in a later statement, which in read committed sees
-- what the other transaction has just committed (A demoting B while B demotes A: the second
-- one is no admin any more and gets 42501). Order: 42501, P0002, EO002, EO003; the values are
-- checked by the callers. Returns the target as it is now.
create function private.lock_operator_target(p_operator_id uuid)
returns app.operators
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target app.operators;
begin
  -- Before the lock too: a caller who is no admin never waits on, nor holds, admin rows.
  if not private.is_admin() then
    raise exception 'Only an admin can change the operators' using errcode = '42501';
  end if;

  perform 1 from app.operators o
  where o.id = p_operator_id or (o.role = 'admin' and o.deactivated_at is null and o.user_id is not null)
  order by o.id
  for update;

  if not private.is_admin() then
    raise exception 'Only an admin can change the operators' using errcode = '42501';
  end if;
  select * into v_target from app.operators o where o.id = p_operator_id;
  if v_target.id is null then
    raise exception 'Operator % not found', p_operator_id using errcode = 'P0002';
  end if;
  if v_target.id = private.acting_operator_id() then
    raise exception 'Nobody can change their own account from here' using errcode = 'EO002';
  end if;
  if v_target.user_id is null then
    raise exception 'Operator % has no account', p_operator_id using errcode = 'EO003';
  end if;
  return v_target;
end;
$$;

revoke execute on function private.lock_operator_target(uuid) from public, anon, authenticated;

-- EO001: taking the role or the access away from an admin who is not deactivated needs at
-- least one OTHER admin, not deactivated, with an account and an accepted invite. With "no
-- action on oneself" it fires only in races, and stays as a defence.
create function private.assert_other_admin(p_target app.operators)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_target.role <> 'admin' or p_target.deactivated_at is not null then
    return;
  end if;
  if not exists (
    select 1 from app.operators o
    join auth.users u on u.id = o.user_id
    where o.id <> p_target.id and o.role = 'admin' and o.deactivated_at is null
      and u.email_confirmed_at is not null and coalesce(u.encrypted_password, '') <> ''
  ) then
    raise exception 'At least one other active admin is needed' using errcode = 'EO001';
  end if;
end;
$$;

revoke execute on function private.assert_other_admin(app.operators) from public, anon, authenticated;

-- set_operator_role: the role of another person. Never 'admin' from a device (EO005, like the
-- invite of an admin): an admin is named from the phone. Same role -> nothing written.
create function app.set_operator_role(p_operator_id uuid, p_role text)
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
    raise exception 'An admin is named from the phone, not from a device' using errcode = 'EO005';
  end if;

  if v_target.role <> p_role then
    if p_role = 'operator' then
      perform private.assert_other_admin(v_target);
    end if;
    update app.operators o set role = p_role where o.id = v_target.id;
  end if;
  return query select * from private.operator_rows(v_target.id);
end;
$$;

-- set_operator_active: deactivate or reactivate another person. Deactivating records who did
-- it and, in the same transaction, closes that person's till turns on every tablet (lock
-- order: operators, then devices; unlock_cashier locks the device and reads the operator
-- without locking it, so there is no cycle). The PIN stays, for the reactivation. The
-- guarantee is valid_cashier_id, which ignores a deactivated cashier on every request.
-- Same state -> nothing written.
create function app.set_operator_active(p_operator_id uuid, p_active boolean)
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

  if p_active and v_target.deactivated_at is not null then
    update app.operators o set deactivated_at = null, deactivated_by = null where o.id = v_target.id;
  elsif not p_active and v_target.deactivated_at is null then
    perform private.assert_other_admin(v_target);
    update app.operators o
    set deactivated_at = now(), deactivated_by = private.acting_operator_id()
    where o.id = v_target.id;
    update app.devices d set cashier_operator_id = null, cashier_since = null
    where d.cashier_operator_id = v_target.id;
  end if;
  return query select * from private.operator_rows(v_target.id);
end;
$$;

revoke execute on function app.list_operators(), app.set_operator_role(uuid, text),
  app.set_operator_active(uuid, boolean) from public, anon;
grant execute on function app.list_operators(), app.set_operator_role(uuid, text),
  app.set_operator_active(uuid, boolean) to authenticated;

-- Invite reservations (SPEC-operators.md point 5, "Modello dati e regole di accesso") ----------
-- The Edge Function operator-invites reserves an invite with operator_invite_begin (caller's
-- token: is_admin is checked here, never in the function), calls Auth with the secret key, then
-- operator_invite_finish creates or relinks the profile. operation_id comes from the app: the
-- same id never sends two invites nor creates two profiles. One pending reservation per email
-- and per name, whatever the operation_id: two invites to the same address or name never reach
-- Auth together (a second inviteUserByEmail would invalidate the first token, and the loser's
-- compensation could delete the winner's user). No API role reads or writes the table: only
-- the security definer functions below.
create table private.operator_invites (
  operation_id uuid primary key,
  requested_by uuid not null references app.operators (id),
  name text not null check (name = private.clean_name(name) and length(name) between 1 and 60),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  role text not null check (role in ('admin', 'operator')),
  status text not null check (status in ('pending', 'done', 'failed')),
  existing_user boolean not null,
  operator_id uuid null references app.operators (id),
  updated_at timestamptz not null default now(),
  constraint operator_invites_done_check check ((status = 'done') = (operator_id is not null))
);

comment on table private.operator_invites is
  'Invite reservations of the Edge Function operator-invites (idempotency). No API access.';
comment on column private.operator_invites.existing_user is
  'The Auth user was already there at the last begin: the function never deletes it.';

create unique index operator_invites_pending_email_key on private.operator_invites (lower(email))
  where status = 'pending';
create unique index operator_invites_pending_name_key on private.operator_invites (lower(name))
  where status = 'pending';

alter table private.operator_invites enable row level security;
revoke all on private.operator_invites from public, anon, authenticated, service_role;

-- {id, name, role} of a profile, as the function returns it to the app.
create function private.operator_brief(p_operator_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', o.id, 'name', o.name, 'role', o.role)
  from app.operators o where o.id = p_operator_id;
$$;

revoke execute on function private.operator_brief(uuid) from public, anon, authenticated;

-- operator_invite_begin: reserve an invite. Answers in jsonb (never an exception for a
-- conflict) so the reservation stays written:
--   proceed      {invited_by_name[, existing_user_id, existing_confirmed, existing_has_password]}
--   done         {operator}: this operation_id already finished, no new email
--   in_progress  this operation_id reserved less than 2 minutes ago, or another pending
--                operation on the same email or name
--   email_is_device, email_taken {deactivated}, name_taken: the reservation is left failed,
--                so a corrected invite (new operation_id) starts at once
-- Exceptions: 42501 not an admin, 22023 invalid input or the same operation_id with other
-- data, EO005 an admin invited from a device. A removed profile (no account) does not take
-- its name: _finish relinks it (Open Questions 4).
create function app.operator_invite_begin(
  p_operation_id uuid, p_name text, p_email text, p_role text
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
  if p_role = 'admin' and private.current_device_id() is not null then
    raise exception 'An admin is invited from the phone, not from a device' using errcode = 'EO005';
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

revoke execute on function app.operator_invite_begin(uuid, text, text, text) from public, anon;
grant execute on function app.operator_invite_begin(uuid, text, text, text) to authenticated;

-- operator_invite_finish (secret key only): after Auth created or reused the user, create the
-- profile or relink the removed one with the same name. In one transaction: the reservation,
-- then the Auth user (for update, as add_operator), then the requester (for share: a
-- concurrent demotion or deactivation either commits first and is seen, or waits). Lock order
-- invites -> auth.users -> operators; set_operator_role/_active lock operators only.
-- Answers done {operator} | name_taken | email_taken {deactivated} | email_is_device |
-- forbidden (the requester is no longer an active admin); a refused finish leaves the
-- reservation pending for _fail. Idempotent: done with the same user -> done, same profile.
-- Raises P0002 unknown operation, 22023 another user (or one whose email is not the reserved
-- one), 55000 an operation that is no longer pending (failed: another may hold the email now).
create function app.operator_invite_finish(p_operation_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invite private.operator_invites;
  v_user auth.users;
  v_operator app.operators;
  v_named app.operators;
  v_operator_id uuid;
begin
  if p_operation_id is null or p_user_id is null then
    raise exception 'operation_id and user_id are required' using errcode = '22023';
  end if;
  select * into v_invite from private.operator_invites i
  where i.operation_id = p_operation_id
  for update;
  if v_invite.operation_id is null then
    raise exception 'Operation % not found', p_operation_id using errcode = 'P0002';
  end if;

  if v_invite.status = 'done' then
    if not exists (
      select 1 from app.operators o where o.id = v_invite.operator_id and o.user_id = p_user_id
    ) then
      raise exception 'Operation % was finished with another user', p_operation_id
        using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'done', 'operator', private.operator_brief(v_invite.operator_id));
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Operation % is not pending', p_operation_id using errcode = '55000';
  end if;

  select * into v_user from auth.users u where u.id = p_user_id for update;
  if v_user.id is null or lower(v_user.email) is distinct from v_invite.email then
    raise exception 'The user is not the one of operation %', p_operation_id using errcode = '22023';
  end if;

  perform 1 from app.operators o
  where o.id = v_invite.requested_by and o.role = 'admin'
    and o.deactivated_at is null and o.user_id is not null
  for share;
  if not found then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if exists (select 1 from app.devices d where d.user_id = p_user_id) then
    return jsonb_build_object('status', 'email_is_device');
  end if;
  select * into v_operator from app.operators o where o.user_id = p_user_id;
  if v_operator.id is not null then
    return jsonb_build_object(
      'status', 'email_taken', 'deactivated', v_operator.deactivated_at is not null);
  end if;

  select * into v_named from app.operators o where lower(o.name) = lower(v_invite.name) for update;
  if v_named.user_id is not null then
    return jsonb_build_object('status', 'name_taken');
  end if;

  begin
    if v_named.id is not null then
      update app.operators o
      set user_id = p_user_id, role = v_invite.role, deactivated_at = null, deactivated_by = null,
          invited_by = v_invite.requested_by, invited_at = now()
      where o.id = v_named.id
      returning o.id into v_operator_id;
    else
      insert into app.operators (user_id, name, role, invited_by, invited_at)
      values (p_user_id, v_invite.name, v_invite.role, v_invite.requested_by, now())
      returning id into v_operator_id;
    end if;
  exception when unique_violation then
    -- A profile with this name or this user committed meanwhile (add_operator by hand).
    if exists (select 1 from app.operators o where o.user_id = p_user_id) then
      return jsonb_build_object('status', 'email_taken', 'deactivated', false);
    end if;
    return jsonb_build_object('status', 'name_taken');
  end;

  update private.operator_invites i
  set status = 'done', operator_id = v_operator_id, updated_at = now()
  where i.operation_id = p_operation_id;
  return jsonb_build_object('status', 'done', 'operator', private.operator_brief(v_operator_id));
end;
$$;

-- operator_invite_fail (secret key only): compensation after Auth or _finish failed. Only
-- pending -> failed (a done operation never changes), so a new tap starts at once. True when
-- it changed the reservation.
create function app.operator_invite_fail(p_operation_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update private.operator_invites i set status = 'failed', updated_at = now()
  where i.operation_id = p_operation_id and i.status = 'pending';
  return found;
end;
$$;

-- operator_invite_orphan (secret key only): may the function delete the Auth user it created
-- for this operation? Read again from the database, never from the answer of _finish: true only
-- when the operation is not done and did not find the user already there, the user has the
-- reserved email, is unconfirmed (nobody opened the link), is linked to no profile and no
-- device, and no other pending operation holds the email (it could be reusing the user).
create function app.operator_invite_orphan(p_operation_id uuid, p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invite private.operator_invites;
  v_user auth.users;
begin
  select * into v_invite from private.operator_invites i where i.operation_id = p_operation_id;
  select * into v_user from auth.users u where u.id = p_user_id for update;
  return v_invite.operation_id is not null and v_user.id is not null
    and v_invite.status <> 'done' and not v_invite.existing_user
    and lower(v_user.email) = v_invite.email
    and v_user.email_confirmed_at is null
    and not exists (select 1 from app.operators o where o.user_id = p_user_id)
    and not exists (select 1 from app.devices d where d.user_id = p_user_id)
    and not exists (
      select 1 from private.operator_invites i
      where i.status = 'pending' and i.operation_id <> p_operation_id and lower(i.email) = v_invite.email);
end;
$$;

revoke execute on function app.operator_invite_finish(uuid, uuid), app.operator_invite_fail(uuid),
  app.operator_invite_orphan(uuid, uuid) from public, anon, authenticated;
grant execute on function app.operator_invite_finish(uuid, uuid), app.operator_invite_fail(uuid),
  app.operator_invite_orphan(uuid, uuid) to service_role;

-- Resend and cancel an invite (SPEC-operators.md point 5) ----------------------------------------
-- Both start with the caller's token (is_admin checked here, never in the Edge Function) and end
-- with a step that only the secret key runs, which reads the database again: between the two
-- steps the requester may have been demoted or deactivated, and the invited person may have
-- accepted. "Invited" = linked, not deactivated, and the invite not accepted (email unconfirmed
-- or no password), the rule of private.operator_rows.

-- The target of a resend or a cancel, with the checks shared by both begins. Order: 42501,
-- P0002, EO002, EO004 (active, deactivated or removed).
create function private.invited_target(p_operator_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_requested_by uuid;
  v_target app.operators;
  v_user auth.users;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can change the invites' using errcode = '42501';
  end if;
  v_requested_by := private.acting_operator_id();
  select * into v_target from app.operators o where o.id = p_operator_id;
  if v_target.id is null then
    raise exception 'Operator % not found', p_operator_id using errcode = 'P0002';
  end if;
  if v_target.id = v_requested_by then
    raise exception 'Nobody can change their own account from here' using errcode = 'EO002';
  end if;
  select * into v_user from auth.users u where u.id = v_target.user_id;
  if v_user.id is null or v_target.deactivated_at is not null
     or (v_user.email_confirmed_at is not null and coalesce(v_user.encrypted_password, '') <> '') then
    raise exception 'Operator % is not waiting for an invite', p_operator_id using errcode = 'EO004';
  end if;
  return jsonb_build_object(
    'user_id', v_user.id,
    'email', v_user.email,
    'name', v_target.name,
    'role_label', case v_target.role when 'admin' then 'amministratore' else 'operatore' end,
    'invited_by_name', (select o.name from app.operators o where o.id = v_requested_by),
    'email_confirmed', v_user.email_confirmed_at is not null,
    'requested_by', v_requested_by);
end;
$$;

revoke execute on function private.invited_target(uuid) from public, anon, authenticated;

-- operator_resend_begin: what the function needs to send the invite again. email_confirmed
-- true (the link was opened, the password never saved) -> a recovery link, since Auth refuses
-- to invite a confirmed user. No idempotency: every resend sends an email, the last one wins.
create function app.operator_resend_begin(p_operator_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.invited_target(p_operator_id);
$$;

-- operator_cancel_begin: the Auth user to delete and who asks.
create function app.operator_cancel_begin(p_operator_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('user_id', t->'user_id', 'requested_by', t->'requested_by')
  from private.invited_target(p_operator_id) t;
$$;

revoke execute on function app.operator_resend_begin(uuid), app.operator_cancel_begin(uuid)
  from public, anon;
grant execute on function app.operator_resend_begin(uuid), app.operator_cancel_begin(uuid)
  to authenticated;

-- operator_resend_finish (secret key only): after the email left, the requester becomes the
-- inviter. Locks the target and the requester by id (the order of lock_operator_target, so a
-- concurrent role or access change queues instead of deadlocking), then checks the requester is
-- still an active admin, as operator_invite_finish. Answers done | forbidden (nothing written);
-- P0002 for an unknown profile.
create function app.operator_resend_finish(p_operator_id uuid, p_requested_by uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform 1 from app.operators o
  where o.id in (p_operator_id, p_requested_by)
  order by o.id
  for update;
  if not exists (select 1 from app.operators o where o.id = p_operator_id) then
    raise exception 'Operator % not found', p_operator_id using errcode = 'P0002';
  end if;
  if p_requested_by is null or p_requested_by = p_operator_id or not exists (
    select 1 from app.operators o
    where o.id = p_requested_by and o.role = 'admin'
      and o.deactivated_at is null and o.user_id is not null
  ) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  update app.operators o set invited_by = p_requested_by, invited_at = now()
  where o.id = p_operator_id;
  return jsonb_build_object('status', 'done');
end;
$$;

-- operator_cancel_check (secret key only): may the function delete this Auth user to cancel the
-- invite? In one transaction: the Auth user (for update, lock order auth.users -> operators as
-- operator_invite_finish), then the target and the requester by id. True only when the profile
-- is still linked to that user, not deactivated, the invite still not accepted, and the
-- requester (not the target) still an active admin. Deleting the user turns the profile into
-- removed (on delete set null); no profile is ever deleted.
create function app.operator_cancel_check(
  p_operator_id uuid, p_user_id uuid, p_requested_by uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user auth.users;
begin
  select * into v_user from auth.users u where u.id = p_user_id for update;
  if v_user.id is null then
    return false;
  end if;
  perform 1 from app.operators o
  where o.id in (p_operator_id, p_requested_by)
  order by o.id
  for update;
  return p_requested_by is distinct from p_operator_id
    and not (v_user.email_confirmed_at is not null and coalesce(v_user.encrypted_password, '') <> '')
    and exists (
      select 1 from app.operators o
      where o.id = p_operator_id and o.user_id = p_user_id and o.deactivated_at is null)
    and exists (
      select 1 from app.operators o
      where o.id = p_requested_by and o.role = 'admin'
        and o.deactivated_at is null and o.user_id is not null);
end;
$$;

revoke execute on function app.operator_resend_finish(uuid, uuid),
  app.operator_cancel_check(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.operator_resend_finish(uuid, uuid),
  app.operator_cancel_check(uuid, uuid, uuid) to service_role;
