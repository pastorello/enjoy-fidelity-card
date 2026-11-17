-- settings: the bar's single configuration row, its access rules, update_settings
-- and the shared private.acting_operator_id() (SPEC-settings.md, "Modello dati e
-- regole di accesso"). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- Initial row ---------------------------------------------------------------------
select is((select count(*) from app.settings), 1::bigint, 'there is exactly one settings row');
select results_eq(
  $$select cents_per_point, confirm_threshold_cents, usb_uid_format, updated_by from app.settings$$,
  $$values (100, 15000, 'hex'::text, null::uuid)$$,
  'the initial row is 100 / 15000 / hex with updated_by null'
);
select throws_ok(
  $$insert into app.settings default values$$,
  '23505',
  null,
  'a second row cannot be inserted'
);
select throws_ok(
  $$insert into app.settings (id) values (false)$$,
  '23514',
  null,
  'the id can only be true'
);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-b000-000000000001', 'settings.admin@example.com'),
  ('00000000-0000-4000-b000-000000000002', 'settings.operator@example.com'),
  ('00000000-0000-4000-b000-000000000003', 'settings.nobody@example.com');
select private.add_operator('settings.admin@example.com', 'Admin Impostazioni', 'admin');
select private.add_operator('settings.operator@example.com', 'Operatore Impostazioni', 'operator');

-- Privileges ------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'app.update_settings(int, int, text)', 'execute'),
  'anon cannot execute update_settings'
);
select ok(
  has_function_privilege('authenticated', 'app.update_settings(int, int, text)', 'execute'),
  'authenticated can execute update_settings'
);
select ok(
  not has_function_privilege('authenticated', 'private.acting_operator_id()', 'execute'),
  'authenticated cannot execute acting_operator_id'
);
select ok(
  not has_function_privilege('anon', 'private.acting_operator_id()', 'execute'),
  'anon cannot execute acting_operator_id'
);

-- anon ------------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select * from app.settings$$,
  '42501',
  null,
  'anon cannot read settings'
);
reset role;

-- Signed-in operator ------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$select cents_per_point, confirm_threshold_cents, usb_uid_format from app.settings$$,
  $$values (100, 15000, 'hex'::text)$$,
  'an active operator reads the settings'
);
select throws_ok(
  $$update app.settings set cents_per_point = 1$$,
  '42501',
  null,
  'a direct update is denied'
);
select throws_ok(
  $$insert into app.settings (id) values (true)$$,
  '42501',
  null,
  'a direct insert is denied'
);
select throws_ok(
  $$delete from app.settings$$,
  '42501',
  null,
  'a direct delete is denied'
);
select throws_ok(
  $$select app.update_settings(200, 20000)$$,
  '42501',
  null,
  'an operator cannot call update_settings'
);

-- Auth user without a profile -----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000003","role":"authenticated"}', true);
select is((select count(*) from app.settings), 0::bigint, 'a user without a profile reads nothing');
select throws_ok(
  $$select app.update_settings(200, 20000)$$,
  '42501',
  null,
  'a user without a profile cannot call update_settings'
);
reset role;

select results_eq(
  $$select cents_per_point, confirm_threshold_cents, usb_uid_format, updated_by from app.settings$$,
  $$values (100, 15000, 'hex'::text, null::uuid)$$,
  'refused calls leave the row unchanged'
);

-- Signed-in admin -----------------------------------------------------------------------
-- Pretend the row was last written in the past, so updated_at visibly moves.
update app.settings set updated_at = now() - interval '1 day';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$select cents_per_point, confirm_threshold_cents, usb_uid_format from app.update_settings(200, 20000)$$,
  $$values (200, 20000, 'hex'::text)$$,
  'an admin updates the values and gets the row back'
);
reset role;
select results_eq(
  $$select cents_per_point, confirm_threshold_cents, usb_uid_format from app.settings$$,
  $$values (200, 20000, 'hex'::text)$$,
  'the update is stored'
);
select ok(
  (select updated_at > now() - interval '1 hour' from app.settings),
  'updated_at moves to the time of the update'
);
select is(
  (select updated_by from app.settings),
  (select id from app.operators where name = 'Admin Impostazioni'),
  'updated_by is the admin profile id (acting_operator_id)'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000001","role":"authenticated"}', true);

-- Limits -------------------------------------------------------------------------------
select throws_ok($$select app.update_settings(0, 15000)$$, '22023', null, 'cents_per_point 0 is invalid');
select throws_ok($$select app.update_settings(-1, 15000)$$, '22023', null, 'negative cents_per_point is invalid');
select throws_ok($$select app.update_settings(10001, 15000)$$, '22023', null, 'cents_per_point 10001 is invalid');
select throws_ok($$select app.update_settings(100, 0)$$, '22023', null, 'confirm_threshold_cents 0 is invalid');
select throws_ok($$select app.update_settings(100, -1)$$, '22023', null, 'negative confirm_threshold_cents is invalid');
select throws_ok($$select app.update_settings(100, 1000001)$$, '22023', null, 'confirm_threshold_cents 1000001 is invalid');
select throws_ok($$select app.update_settings(null, 15000)$$, '22023', null, 'null cents_per_point is invalid');
select throws_ok($$select app.update_settings(100, null)$$, '22023', null, 'null confirm_threshold_cents is invalid');
select throws_ok($$select app.update_settings(100, 15000, 'binary')$$, '22023', null, 'an unknown USB uid format is invalid');

select results_eq(
  $$select cents_per_point, confirm_threshold_cents from app.update_settings(1, 1)$$,
  $$values (1, 1)$$,
  'the lower limits 1 and 1 are accepted'
);
select results_eq(
  $$select cents_per_point, confirm_threshold_cents from app.update_settings(10000, 1000000)$$,
  $$values (10000, 1000000)$$,
  'the upper limits 10000 and 1000000 are accepted'
);

-- USB uid format ---------------------------------------------------------------------------
select is(
  (select usb_uid_format from app.update_settings(100, 15000, null)),
  'hex',
  'a null format leaves it unchanged'
);
select is(
  (select usb_uid_format from app.update_settings(100, 15000, 'dec')),
  'dec',
  'dec changes the format'
);
select is(
  (select usb_uid_format from app.update_settings(100, 15000)),
  'dec',
  'omitting the format leaves it unchanged'
);

-- Idempotent ----------------------------------------------------------------------------------
select results_eq(
  $$select cents_per_point, confirm_threshold_cents, usb_uid_format from app.update_settings(250, 30000)$$,
  $$values (250, 30000, 'dec'::text)$$,
  'first call with new values'
);
select results_eq(
  $$select cents_per_point, confirm_threshold_cents, usb_uid_format from app.update_settings(250, 30000)$$,
  $$values (250, 30000, 'dec'::text)$$,
  'a repeated call with the same values gives the same values'
);
reset role;

select is((select count(*) from app.settings), 1::bigint, 'there is still exactly one row');
select is(
  (select updated_by from app.settings),
  (select id from app.operators where name = 'Admin Impostazioni'),
  'updated_by still names the admin'
);

select * from finish();
rollback;
