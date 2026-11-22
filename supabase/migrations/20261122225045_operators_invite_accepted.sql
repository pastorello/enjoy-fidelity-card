-- operators: "invite accepted" = a password the person chose (review findings; SPEC-operators
-- point 2, Open Questions 12). The rule "email confirmed and a password" read two people as active
-- who never chose a password:
--   - whoever opens the invite link and leaves: GoTrue (signupVerify) gives an invited user
--     without a password a random temporary one when the token is verified, in the same
--     transaction that confirms the email (temporary password first, then email_confirmed_at);
--   - an Auth user made in the dashboard, confirmed with a password: the Edge Function replaces
--     the password with a random one before the profile exists (point 5, step 2).
-- Both stayed "attivo": no resend, no cancel, and counted as an accepted admin for EO001.
--
-- New column app.operators.invite_accepted_at, set by a trigger on auth.users when the password
-- changes on a user whose email was ALREADY confirmed (the person's own updateUser after the
-- verify or a recovery link; never the temporary password of the verify, set while the email is
-- still unconfirmed; never the random password of the function, set before the profile exists).
-- operator_invite_finish links with null; add_operator (accounts made by hand, V1) sets it when
-- the user already has a confirmed email and a password, as the old rule read them. The rule
-- stays "and" with the old one: accepted = invite_accepted_at and email confirmed and a password.
-- Used by operator_rows (list_operators), assert_other_admin (EO001), invited_target (resend and
-- cancel begin) and operator_cancel_check. Functions restated whole with only that change;
-- signatures and privileges unchanged.

alter table app.operators add column invite_accepted_at timestamptz null;

comment on column app.operators.invite_accepted_at is
  'When the person chose their own password (trigger on auth.users); null = invite not accepted.';

-- Profiles already there: accepted as the old rule read them (accounts made by hand, the seed).
update app.operators o set invite_accepted_at = now()
from auth.users u
where u.id = o.user_id and u.email_confirmed_at is not null and coalesce(u.encrypted_password, '') <> '';

-- The rule, in one place.
create function private.invite_accepted(
  p_invite_accepted_at timestamptz, p_email_confirmed_at timestamptz, p_encrypted_password text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_invite_accepted_at is not null and p_email_confirmed_at is not null
    and coalesce(p_encrypted_password, '') <> '';
$$;

revoke execute on function private.invite_accepted(timestamptz, timestamptz, text)
  from public, anon, authenticated;

-- The trigger: a password changed on a confirmed user is the person's own.
create function private.mark_invite_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app.operators o set invite_accepted_at = now()
  where o.user_id = new.id and o.invite_accepted_at is null;
  return null;
end;
$$;

revoke execute on function private.mark_invite_accepted() from public, anon, authenticated;

create trigger operators_mark_invite_accepted
after update of encrypted_password on auth.users
for each row
when (
  old.email_confirmed_at is not null
  and new.encrypted_password is distinct from old.encrypted_password
  and coalesce(new.encrypted_password, '') <> ''
)
execute function private.mark_invite_accepted();

create or replace function private.operator_rows(p_operator_id uuid)
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
           when private.invite_accepted(o.invite_accepted_at, u.email_confirmed_at, u.encrypted_password) then 'active'
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

create or replace function private.assert_other_admin(p_target app.operators)
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
      and private.invite_accepted(o.invite_accepted_at, u.email_confirmed_at, u.encrypted_password)
  ) then
    raise exception 'At least one other active admin is needed' using errcode = 'EO001';
  end if;
end;
$$;

revoke execute on function private.assert_other_admin(app.operators) from public, anon, authenticated;

create or replace function private.invited_target(p_operator_id uuid)
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
     or private.invite_accepted(v_target.invite_accepted_at, v_user.email_confirmed_at,
                                v_user.encrypted_password) then
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

create or replace function app.operator_cancel_check(
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
    and exists (
      select 1 from app.operators o
      where o.id = p_operator_id and o.user_id = p_user_id and o.deactivated_at is null
        and not private.invite_accepted(o.invite_accepted_at, v_user.email_confirmed_at,
                                        v_user.encrypted_password))
    and exists (
      select 1 from app.operators o
      where o.id = p_requested_by and o.role = 'admin'
        and o.deactivated_at is null and o.user_id is not null);
end;
$$;

revoke execute on function app.operator_cancel_check(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.operator_cancel_check(uuid, uuid, uuid) to service_role;

create or replace function private.add_operator(p_email text, p_name text, p_role text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_password_set boolean;
  v_name text := btrim(p_name);
  v_linked app.operators;
  v_named app.operators;
begin
  select id, email_confirmed_at is not null and coalesce(encrypted_password, '') <> ''
  into v_user_id, v_password_set
  from auth.users where lower(email) = lower(btrim(p_email)) for update;
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
    if v_named.user_id is null then
      -- A removed profile gets a new account: its person sets a new PIN.
      delete from private.operator_pins where operator_id = v_named.id;
    end if;
    update app.operators
    set user_id = v_user_id, role = p_role, deactivated_at = null, deactivated_by = null,
        invite_accepted_at = case
          when v_named.user_id = v_user_id and v_named.invite_accepted_at is not null
            then v_named.invite_accepted_at
          when v_password_set then now()
        end
    where id = v_named.id;
    return v_named.id;
  end if;

  insert into app.operators (user_id, name, role, invite_accepted_at)
  values (v_user_id, v_name, p_role, case when v_password_set then now() end)
  returning id into v_named.id;
  return v_named.id;
end;
$$;

revoke execute on function private.add_operator(text, text, text)
  from public, anon, authenticated, service_role;

create or replace function app.operator_invite_finish(p_operation_id uuid, p_user_id uuid)
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
      -- v_named has no account here (removed): the PIN of the old one is not the new person's.
      delete from private.operator_pins p where p.operator_id = v_named.id;
      update app.operators o
      set user_id = p_user_id, role = v_invite.role, deactivated_at = null, deactivated_by = null,
          invited_by = v_invite.requested_by, invited_at = now(), invite_accepted_at = null
      where o.id = v_named.id
      returning o.id into v_operator_id;
    else
      insert into app.operators (user_id, name, role, invited_by, invited_at, invite_accepted_at)
      values (p_user_id, v_invite.name, v_invite.role, v_invite.requested_by, now(), null)
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

revoke execute on function app.operator_invite_finish(uuid, uuid) from public, anon, authenticated;
grant execute on function app.operator_invite_finish(uuid, uuid) to service_role;
