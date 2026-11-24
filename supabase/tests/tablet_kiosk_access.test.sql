-- tablet-kiosk: the access helpers extended to the cashier of a device account
-- (SPEC-tablet-kiosk.md, "Modello dati e regole di accesso", success criteria 1
-- and 2). A device without a valid cashier reads nothing and writes nothing; with
-- one, every check and every author column follows the cashier. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(79);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000001', 'kiosk.admin@example.com'),
  ('00000000-0000-4000-a000-000000000002', 'kiosk.operator@example.com'),
  ('00000000-0000-4000-a000-000000000003', 'kiosk.nopin@example.com'),
  ('00000000-0000-4000-a000-000000000004', 'kiosk.device@example.com'),
  ('00000000-0000-4000-a000-000000000005', 'kiosk.gone@example.com');
select private.add_operator('kiosk.admin@example.com', 'Admin Cassa', 'admin');
select private.add_operator('kiosk.operator@example.com', 'Operatore Cassa', 'operator');
select private.add_operator('kiosk.nopin@example.com', 'Senza PIN Cassa', 'operator');
select private.add_operator('kiosk.gone@example.com', 'Andato Via Cassa', 'operator');
select private.add_device('kiosk.device@example.com', 'Tablet Accesso');

-- Fake PINs (bcrypt, as set_my_pin will store them). 'Senza PIN Cassa' has none.
insert into private.operator_pins (operator_id, pin_hash)
select id, extensions.crypt('1234', extensions.gen_salt('bf', 8))
from app.operators
where name in ('Admin Cassa', 'Operatore Cassa', 'Andato Via Cassa');

-- One row in every table and view of app, so 0 rows below means hidden, not empty.
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
select '00000000-0000-4000-a100-000000000001', 'Cliente Cassa', now(), o.id,
  '00000000-0000-4000-a200-000000000001'
from app.operators o where o.name = 'Admin Cassa';
insert into app.cards (uid, customer_id, associated_by)
select 'A0B1C2D3E4F5A6', '00000000-0000-4000-a100-000000000001', o.id
from app.operators o where o.name = 'Admin Cassa';
insert into app.rewards (id, name, points, created_by, updated_by)
select '00000000-0000-4000-a300-000000000001', 'Caffè Cassa', 1, o.id, o.id
from app.operators o where o.name = 'Admin Cassa';
insert into app.movements
  (id, operation_id, customer_id, kind, amount_cents, points, cents_per_point, operator_id)
select '00000000-0000-4000-a400-000000000001', '00000000-0000-4000-a200-000000000002',
  '00000000-0000-4000-a100-000000000001', 'purchase', 5000, 50, 100, o.id
from app.operators o where o.name = 'Admin Cassa';

-- Every table and view of app (read from pg_catalog, so a new one is covered too):
-- 'name:count' when the caller may select from it, 'name:denied' otherwise.
create function pg_temp.app_row_counts()
returns setof text
language plpgsql
as $$
declare
  v_rel regclass;
  v_count bigint;
begin
  for v_rel in
    select c.oid::regclass from pg_class c
    where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
    order by c.relname
  loop
    begin
      execute format('select count(*) from %s', v_rel) into v_count;
      return next v_rel::text || ':' || v_count;
    exception when insufficient_privilege then
      return next v_rel::text || ':denied';
    end;
  end loop;
end;
$$;
grant execute on function pg_temp.app_row_counts() to authenticated;

-- What a caller without any access must get: 0 rows where the API role may select,
-- denied where it may not (app.devices).
create function pg_temp.expected_hidden()
returns text[]
language sql
as $$
  select array(
    select c.oid::regclass::text
      || case when has_table_privilege('authenticated', c.oid, 'select') then ':0' else ':denied' end
    from pg_class c
    where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
    order by c.relname
  );
$$;

select is(
  array(select r from pg_temp.app_row_counts() r where r like '%:0' or r like '%:denied'),
  array[]::text[],
  'precondition: as postgres every table and view of app has rows'
);
select set_config('test.hidden', pg_temp.expected_hidden()::text, true);

-- Every function of app, classified. A new one fails the last test until it is
-- placed here: read and write RPCs must refuse a device without a cashier; the
-- kiosk RPCs (tasks 4 and 5) answer devices by design and have their own tests; the
-- service steps of operator-invites run only with the secret key (operators_invites.test.sql).
create temp table rpc_calls (name text primary key, kind text, call text, errcode text, message text);
insert into rpc_calls values
  ('get_customer', 'read',
   $$select * from app.get_customer('00000000-0000-4000-a100-000000000001')$$, 'P0001', 'not_operator'),
  ('list_customers', 'read', $$select * from app.list_customers()$$, 'P0001', 'not_operator'),
  ('lookup_card', 'read', $$select * from app.lookup_card('A0B1C2D3E4F5A6')$$, 'P0001', 'not_operator'),
  ('get_card', 'read',
   $$select * from app.get_card((select id from app.cards where uid = 'A0B1C2D3E4F5A6'))$$,
   'P0001', 'not_operator'),
  ('export_customers', 'read', $$select * from app.export_customers(null, 10)$$, '42501', 'forbidden'),
  ('export_movements', 'read', $$select * from app.export_movements(null, null, 10)$$, '42501', 'forbidden'),
  ('create_customer', 'write',
   $$select app.create_customer(gen_random_uuid(), 'Nuovo Cassa', null, true, null)$$,
   'P0001', 'not_operator'),
  ('create_customer_with_card', 'write',
   $$select app.create_customer_with_card(gen_random_uuid(), 'Nuovo Card Cassa', null, true, null,
     'A0B1C2D3E4F5A7')$$,
   'P0001', 'not_operator'),
  ('update_customer', 'write',
   $$select app.update_customer('00000000-0000-4000-a100-000000000001', 'Cliente Cassa Due', null, null)$$,
   'P0001', 'not_operator'),
  ('anonymize_customer', 'write',
   $$select app.anonymize_customer('00000000-0000-4000-a100-000000000001')$$, 'P0001', 'not_operator'),
  ('associate_card', 'write',
   $$select app.associate_card('00000000-0000-4000-a100-000000000001', 'A0B1C2D3E4F5A8')$$,
   'P0001', 'not_operator'),
  ('release_card', 'write',
   $$select app.release_card(gen_random_uuid(), (select id from app.cards where uid = 'A0B1C2D3E4F5A6'))$$,
   'P0001', 'not_operator'),
  ('reactivate_card', 'write',
   $$select app.reactivate_card((select id from app.cards where uid = 'A0B1C2D3E4F5A6'), null)$$,
   'P0001', 'not_operator'),
  ('deactivate_card', 'write',
   $$select app.deactivate_card((select id from app.cards where uid = 'A0B1C2D3E4F5A6'))$$,
   'P0001', 'not_operator'),
  ('issue_card_link', 'write',
   $$select app.issue_card_link(gen_random_uuid())$$, 'P0001', 'not_operator'),
  ('confirm_card_link', 'write',
   $$select app.confirm_card_link(gen_random_uuid(), 'token')$$, 'P0001', 'not_operator'),
  ('create_reward', 'write',
   $$select app.create_reward(gen_random_uuid(), 'Premio Cassa', 5, true)$$,
   '42501', 'Only an admin can change the rewards'),
  ('update_reward', 'write',
   $$select app.update_reward('00000000-0000-4000-a300-000000000001', 'Caffè Cassa Due', 2)$$,
   '42501', 'Only an admin can change the rewards'),
  ('set_reward_active', 'write',
   $$select app.set_reward_active('00000000-0000-4000-a300-000000000001', false)$$,
   '42501', 'Only an admin can change the rewards'),
  ('record_purchase', 'write',
   $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-a100-000000000001', 1250)$$,
   '42501', 'No acting operator for this write'),
  ('redeem_reward', 'write',
   $$select app.redeem_reward(gen_random_uuid(), '00000000-0000-4000-a100-000000000001',
     '00000000-0000-4000-a300-000000000001')$$,
   '42501', 'No acting operator for this write'),
  ('redeem_free_reward', 'write',
   $$select app.redeem_free_reward(gen_random_uuid(), '00000000-0000-4000-a100-000000000001',
     'Cornetto', 1)$$,
   '42501', 'No acting operator for this write'),
  ('cancel_movement', 'write',
   $$select app.cancel_movement(gen_random_uuid(), '00000000-0000-4000-a400-000000000001')$$,
   '42501', 'No acting operator for this write'),
  ('list_operators', 'read', $$select * from app.list_operators()$$, '42501',
   'Only an admin can list the operators'),
  ('set_operator_role', 'write',
   $$select * from app.set_operator_role('00000000-0000-4000-0000-0000000000ff', 'operator')$$,
   '42501', 'Only an admin can change the operators'),
  ('set_operator_active', 'write',
   $$select * from app.set_operator_active('00000000-0000-4000-0000-0000000000ff', false)$$,
   '42501', 'Only an admin can change the operators'),
  ('set_operator_role_with_pin', 'write',
   $$select app.set_operator_role_with_pin('00000000-0000-4000-0000-0000000000ff', 'admin', '1234')$$,
   '42501', 'Only an admin can change the operators'),
  ('set_operator_active_with_pin', 'write',
   $$select app.set_operator_active_with_pin('00000000-0000-4000-0000-0000000000ff', true, '1234')$$,
   '42501', 'Only an admin can change the operators'),
  ('operator_invite_begin', 'write',
   $$select app.operator_invite_begin(gen_random_uuid(), 'Nuovo Cassa', 'nuovo.cassa@example.com',
     'operator')$$,
   '42501', 'Only an admin can invite'),
  ('operator_resend_begin', 'write',
   $$select app.operator_resend_begin('00000000-0000-4000-0000-0000000000ff')$$,
   '42501', 'Only an admin can change the invites'),
  ('operator_cancel_begin', 'write',
   $$select app.operator_cancel_begin('00000000-0000-4000-0000-0000000000ff')$$,
   '42501', 'Only an admin can change the invites'),
  -- The steps of operator-invites that need the secret key: never executable by a session.
  ('operator_invite_finish', 'service',
   $$select app.operator_invite_finish(gen_random_uuid(), gen_random_uuid())$$,
   '42501', 'permission denied for function operator_invite_finish'),
  ('operator_invite_fail', 'service',
   $$select app.operator_invite_fail(gen_random_uuid())$$,
   '42501', 'permission denied for function operator_invite_fail'),
  ('operator_invite_orphan', 'service',
   $$select app.operator_invite_orphan(gen_random_uuid(), gen_random_uuid())$$,
   '42501', 'permission denied for function operator_invite_orphan'),
  ('operator_resend_finish', 'service',
   $$select app.operator_resend_finish(gen_random_uuid(), gen_random_uuid())$$,
   '42501', 'permission denied for function operator_resend_finish'),
  ('operator_cancel_check', 'service',
   $$select app.operator_cancel_check(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$$,
   '42501', 'permission denied for function operator_cancel_check'),
  ('update_settings', 'write',
   $$select app.update_settings(100, 15000, null)$$, '42501', 'Only an admin can change the settings');
grant select on rpc_calls to authenticated;

select set_config('test.device_id', (select id::text from app.devices where name = 'Tablet Accesso'), true);
select set_config('test.admin_id', (select id::text from app.operators where name = 'Admin Cassa'), true);
select set_config('test.operator_id', (select id::text from app.operators where name = 'Operatore Cassa'), true);
select set_config('test.nopin_id', (select id::text from app.operators where name = 'Senza PIN Cassa'), true);
select set_config('test.gone_id', (select id::text from app.operators where name = 'Andato Via Cassa'), true);
select set_config('test.cents_per_point', (select cents_per_point::text from app.settings), true);
select set_config('test.threshold', (select confirm_threshold_cents::text from app.settings), true);

-- Criterion 1: a device without a cashier reads nothing and writes nothing ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000004","role":"authenticated"}', true);
select is(private.acting_operator_id(), null, 'a device without a cashier has no acting operator');

set local role authenticated;
select ok(not private.is_active_operator(), 'a device without a cashier is not an active operator');
select ok(not private.is_admin(), 'a device without a cashier is not an admin');
select is(
  array(select pg_temp.app_row_counts()),
  current_setting('test.hidden')::text[],
  'a device without a cashier gets 0 rows from every table and view of app'
);
select throws_ok(r.call, r.errcode, r.message,
  'a device without a cashier: ' || r.name || ' is refused as for a caller without an operator')
from rpc_calls r order by r.kind, r.name;
reset role;

select is(
  array(
    select p.proname::text from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname not in (select name from rpc_calls)
      and p.proname not in ('get_session_identity', 'list_cashiers', 'unlock_cashier',
                            'end_cashier_turn', 'set_my_pin')
    order by 1
  ),
  array[]::text[],
  'every function of app is classified as read, write or kiosk'
);

-- Criterion 2: with a valid cashier the device acts as the cashier -----------------
update app.devices
set cashier_operator_id = current_setting('test.operator_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;

select is(
  private.acting_operator_id(),
  current_setting('test.operator_id')::uuid,
  'with a cashier the acting operator is the cashier'
);
select is(private.current_operator_id(), null, 'the device itself is still not an operator');

set local role authenticated;
select ok(private.is_active_operator(), 'with a cashier the device is an active operator');
select ok(not private.is_admin(), 'with an operator cashier the device is not an admin');
select ok(
  (select count(*) from app.customers) > 0 and (select count(*) from app.movement_history) > 0,
  'with a cashier the device reads customers and the history'
);
select set_config('test.purchase', (
  select (app.record_purchase('00000000-0000-4000-a200-000000000010',
    '00000000-0000-4000-a100-000000000001', 1250)).movement.id::text
), true);
select set_config('test.customer', (
  select (app.create_customer('00000000-0000-4000-a200-000000000011', 'Nuovo Dal Tablet', null, true,
    null)).id::text
), true);
select throws_ok(
  format('select app.update_settings(%s, %s, null)',
    current_setting('test.cents_per_point'), current_setting('test.threshold')),
  '42501',
  'Only an admin can change the settings',
  'update_settings is refused with an operator cashier'
);
reset role;

select is(
  (select operator_id from app.movements where id = current_setting('test.purchase')::uuid),
  current_setting('test.operator_id')::uuid,
  'a purchase recorded by the device has operator_id = cashier'
);
select is(
  (select created_by from app.customers where id = current_setting('test.customer')::uuid),
  current_setting('test.operator_id')::uuid,
  'a customer created by the device has created_by = cashier'
);

update app.devices
set cashier_operator_id = current_setting('test.admin_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;

set local role authenticated;
select ok(private.is_admin(), 'with an admin cashier the device is an admin');
select lives_ok(
  format('select app.update_settings(%s, %s, %L)',
    current_setting('test.cents_per_point'), current_setting('test.threshold'), 'dec'),
  'update_settings succeeds with an admin cashier'
);
reset role;
select is(
  (select row(usb_uid_format, updated_by)::text from app.settings),
  row('dec', current_setting('test.admin_id')::uuid)::text,
  'the settings record the admin cashier as their author'
);

-- When the turn is not valid the device is back to nothing ------------------------
-- 12 hours after the unlock: just inside, then just outside.
update app.devices
set cashier_since = now() - interval '12 hours' + interval '1 second'
where id = current_setting('test.device_id')::uuid;
select is(
  private.acting_operator_id(),
  current_setting('test.admin_id')::uuid,
  'a turn younger than 12 hours is still valid'
);

update app.devices
set cashier_since = now() - interval '12 hours'
where id = current_setting('test.device_id')::uuid;
select is(private.acting_operator_id(), null, 'a turn of 12 hours or more has no acting operator');
set local role authenticated;
select ok(not private.is_active_operator(), 'an expired turn is not an active operator');
select ok(not private.is_admin(), 'an expired turn of an admin is not an admin');
select is(
  array(select pg_temp.app_row_counts()),
  current_setting('test.hidden')::text[],
  'an expired turn gets 0 rows from every table and view of app'
);
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-a100-000000000001', 1250)$$,
  '42501',
  'No acting operator for this write',
  'an expired turn cannot record a purchase'
);
reset role;

-- A cashier without a PIN (never set, or the row is gone).
update app.devices
set cashier_operator_id = current_setting('test.nopin_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;
select is(private.acting_operator_id(), null, 'a cashier without a PIN has no acting operator');
set local role authenticated;
select ok(not private.is_active_operator(), 'a cashier without a PIN is not an active operator');
reset role;

delete from private.operator_pins where operator_id = current_setting('test.admin_id')::uuid;
update app.devices
set cashier_operator_id = current_setting('test.admin_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;
select is(private.acting_operator_id(), null, 'a cashier whose PIN was removed has no acting operator');
set local role authenticated;
select ok(not private.is_admin(), 'an admin cashier whose PIN was removed is not an admin');
reset role;

-- A cashier whose Auth user was deleted (operators.user_id is null).
update app.devices
set cashier_operator_id = current_setting('test.gone_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;
select is(
  private.acting_operator_id(),
  current_setting('test.gone_id')::uuid,
  'precondition: the cashier with a PIN and an account acts'
);
delete from auth.users where id = '00000000-0000-4000-a000-000000000005';
select is(private.acting_operator_id(), null, 'a cashier whose account was deleted has no acting operator');
set local role authenticated;
select ok(not private.is_active_operator(), 'a cashier whose account was deleted is not an active operator');
select is(
  array(select pg_temp.app_row_counts()),
  current_setting('test.hidden')::text[],
  'a cashier whose account was deleted gives 0 rows from every table and view of app'
);
reset role;

-- A valid cashier on a device whose own account was deleted: its old token is nobody.
update app.devices
set cashier_operator_id = current_setting('test.operator_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;
delete from auth.users where id = '00000000-0000-4000-a000-000000000004';
select is(private.acting_operator_id(), null, 'the token of a deleted device account has no acting operator');
set local role authenticated;
select ok(not private.is_active_operator(), 'the token of a deleted device account is not an active operator');
reset role;

-- Operator accounts are unchanged -------------------------------------------------
-- (the pgTAP of identity and of every other module stay green without changes)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
select is(
  private.acting_operator_id(),
  current_setting('test.operator_id')::uuid,
  'an operator account acts as itself'
);
set local role authenticated;
select ok(private.is_active_operator(), 'an operator account is an active operator');
select ok(not private.is_admin(), 'an operator account is not an admin');
reset role;

-- An operator without a PIN still works from the phone: the PIN is only for the till.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000003","role":"authenticated"}', true);
select is(
  private.acting_operator_id(),
  current_setting('test.nopin_id')::uuid,
  'an operator account without a PIN acts as itself'
);
set local role authenticated;
select ok(private.is_active_operator(), 'an operator account without a PIN is an active operator');
reset role;

-- The admin whose PIN was removed above is still an admin on the phone.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select ok(private.is_admin(), 'an admin account is an admin, PIN or not');
reset role;

-- Same signature, attributes and privileges as before --------------------------------
select is(
  array(
    select p.proname || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':'
      || array_to_string(p.proconfig, ',') || ':' || pg_get_function_result(p.oid)
    from pg_proc p
    where p.oid in ('private.acting_operator_id()'::regprocedure,
                    'private.is_active_operator()'::regprocedure,
                    'private.is_admin()'::regprocedure)
    order by p.proname
  ),
  array['acting_operator_id:true:s:search_path="":uuid',
        'is_active_operator:true:s:search_path="":boolean',
        'is_admin:true:s:search_path="":boolean'],
  'the three helpers keep signature, security definer, stable and an empty search_path'
);
select ok(
  not has_function_privilege('authenticated', 'private.acting_operator_id()', 'execute'),
  'authenticated still cannot execute acting_operator_id'
);
select ok(
  has_function_privilege('authenticated', 'private.is_active_operator()', 'execute')
    and has_function_privilege('authenticated', 'private.is_admin()', 'execute'),
  'authenticated still executes is_active_operator and is_admin (the policies need them)'
);

select * from finish();
rollback;
