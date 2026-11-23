-- operators: relinking a removed profile to a new account drops the PIN of the old account
-- (review finding). The removed profile kept its row in private.operator_pins, so the new person
-- would show "PIN impostato" and whoever knew the old PIN could open a till turn in their name.
-- Relinking the SAME account (add_operator on a deactivated profile) keeps the PIN, as a
-- reactivation does (SPEC-operators point 7). Both functions are restated whole from
-- 20261122180044_operators.sql with only that change; signatures and privileges unchanged.

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
    if v_named.user_id is null then
      -- A removed profile gets a new account: its person sets a new PIN.
      delete from private.operator_pins where operator_id = v_named.id;
    end if;
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

revoke execute on function app.operator_invite_finish(uuid, uuid) from public, anon, authenticated;
grant execute on function app.operator_invite_finish(uuid, uuid) to service_role;
