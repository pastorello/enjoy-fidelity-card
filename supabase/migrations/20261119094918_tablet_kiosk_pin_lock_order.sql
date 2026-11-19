-- tablet-kiosk: set_my_pin and unlock_cashier take their row locks in the same order.
--
-- unlock_cashier locks the device row (for update) and then reads the operator's PIN row
-- (for share). set_my_pin used to write the PIN row first and only then close the turns
-- on the devices where the caller was the cashier: with the caller already the cashier on
-- that device, each transaction waited for the other and Postgres aborted one (40P01).
-- Now set_my_pin locks those device rows first (in id order), then writes the PIN, then
-- closes the turns: both functions go device row, then PIN row.
--
-- A device that becomes the caller's cashier after the first lock is still covered: its
-- unlock holds the PIN row (for share), so the upsert waits for it, and the final update
-- (a new statement, so a new snapshot) sees and closes the turn that unlock opened.
-- Signature, privileges and checks are unchanged.

create or replace function app.set_my_pin(p_pin text)
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

  perform 1 from app.devices
  where cashier_operator_id = v_operator_id
  order by id
  for update;

  insert into private.operator_pins (operator_id, pin_hash, updated_at)
  values (v_operator_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), now())
  on conflict (operator_id) do update
    set pin_hash = excluded.pin_hash, updated_at = excluded.updated_at;

  update app.devices
  set cashier_operator_id = null, cashier_since = null
  where cashier_operator_id = v_operator_id;
end;
$$;
