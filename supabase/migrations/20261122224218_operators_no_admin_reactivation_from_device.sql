-- operators: a device never gives back an admin account (review finding; SPEC-operators point 7,
-- Open Questions 11). Inviting an admin and naming one already raise EO005 from a device, so the
-- 12-hour till turn and the 4-digit PIN never turn into a permanent admin session; reactivating a
-- deactivated admin did the same and is now refused the same way. Reactivating an operator from a
-- device still works. Restated whole from 20261122180044_operators.sql with only that check;
-- signature and privileges unchanged.

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

  if p_active and v_target.deactivated_at is not null then
    if v_target.role = 'admin' and private.current_device_id() is not null then
      raise exception 'An admin is reactivated from the phone, not from a device' using errcode = 'EO005';
    end if;
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

revoke execute on function app.set_operator_active(uuid, boolean) from public, anon;
grant execute on function app.set_operator_active(uuid, boolean) to authenticated;
