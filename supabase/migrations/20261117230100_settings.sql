-- settings V1 (SPEC-settings.md): the bar's single configuration row, readable
-- by active operators and written only through app.update_settings (admins).
-- Also introduces private.acting_operator_id(), shared with customers, rewards
-- and ledger (docs/specs/cross-review.md §1): keep its body identical there.

-- One row only: the primary key can only be true.
create table app.settings (
  id boolean primary key default true check (id),
  cents_per_point int not null default 100 check (cents_per_point between 1 and 10000),
  confirm_threshold_cents int not null default 15000
    check (confirm_threshold_cents between 1 and 1000000),
  usb_uid_format text not null default 'hex'
    check (usb_uid_format in ('hex', 'hex-reversed', 'dec', 'dec-reversed')),
  updated_at timestamptz not null default now(),
  -- null only for the initial row written by this migration
  updated_by uuid null references app.operators (id)
);

comment on table app.settings is
  'Bar configuration, a single row. Amounts in integer cents; changed only by app.update_settings.';

insert into app.settings default values;

-- The row is never created, changed or deleted through the API.
revoke insert, update, delete, truncate on app.settings from authenticated, anon;

create policy settings_select_for_active_operators
  on app.settings
  for select
  to authenticated
  using ((select private.is_active_operator()));

-- acting_operator_id -------------------------------------------------------------
-- The operator a write is recorded against. Called only from security definer
-- functions, so no API role may execute it. tablet-kiosk redefines it later.
create or replace function private.acting_operator_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_operator_id();
$$;

revoke execute on function private.acting_operator_id() from public, anon, authenticated;

-- update_settings ------------------------------------------------------------------
-- Sets absolute values, so a repeated call is harmless. p_usb_uid_format null
-- keeps the current format (the phone never sends it).
create function app.update_settings(
  p_cents_per_point int,
  p_confirm_threshold_cents int,
  p_usb_uid_format text default null
)
returns app.settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.settings;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can change the settings' using errcode = '42501';
  end if;
  if p_cents_per_point is null or p_cents_per_point not between 1 and 10000 then
    raise exception 'cents_per_point must be between 1 and 10000, got %', p_cents_per_point
      using errcode = '22023';
  end if;
  if p_confirm_threshold_cents is null or p_confirm_threshold_cents not between 1 and 1000000 then
    raise exception 'confirm_threshold_cents must be between 1 and 1000000, got %',
      p_confirm_threshold_cents
      using errcode = '22023';
  end if;
  if p_usb_uid_format is not null
    and p_usb_uid_format not in ('hex', 'hex-reversed', 'dec', 'dec-reversed') then
    raise exception 'Unknown usb_uid_format %', p_usb_uid_format using errcode = '22023';
  end if;

  update app.settings
  set cents_per_point = p_cents_per_point,
      confirm_threshold_cents = p_confirm_threshold_cents,
      usb_uid_format = coalesce(p_usb_uid_format, usb_uid_format),
      updated_at = now(),
      updated_by = private.acting_operator_id()
  where id
  returning * into v_row;

  return v_row;
end;
$$;

-- Explicit grants: never rely on the default privileges.
revoke execute on function app.update_settings(int, int, text) from public, anon;
grant execute on function app.update_settings(int, int, text) to authenticated;
