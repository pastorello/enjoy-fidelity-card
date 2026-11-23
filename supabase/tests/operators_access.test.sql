-- operators: a deactivated profile has no access at all (SPEC-operators.md, "Modello dati e
-- regole di accesso", "Helper ridefiniti"; point 7). Its still valid token reads nothing and
-- writes nothing, its account has no session identity, and as a cashier it is neither listed
-- nor unlocked, nor does an open turn give its tablet anything. Clearing deactivated_at gives
-- everything back; add_operator on a deactivated profile reactivates it with its history.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(81);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-d000-000000000001', 'op.access.admin@example.com'),
  ('00000000-0000-4000-d000-000000000002', 'op.access.off@example.com'),
  ('00000000-0000-4000-d000-000000000003', 'op.access.offadmin@example.com'),
  ('00000000-0000-4000-d000-000000000004', 'op.access.device@example.com');
select private.add_operator('op.access.admin@example.com', 'Admin Accesso Operatori', 'admin');
select private.add_operator('op.access.off@example.com', 'Spento Accesso Operatori', 'operator');
select private.add_operator('op.access.offadmin@example.com', 'Admin Spento Accesso Operatori', 'admin');
select private.add_device('op.access.device@example.com', 'Tablet Accesso Operatori');

-- Fake PINs (bcrypt, as set_my_pin stores them).
insert into private.operator_pins (operator_id, pin_hash)
select id, extensions.crypt('1234', extensions.gen_salt('bf', 8))
from app.operators
where name in ('Admin Accesso Operatori', 'Spento Accesso Operatori', 'Admin Spento Accesso Operatori');

select set_config('test.admin_id', (select id::text from app.operators where name = 'Admin Accesso Operatori'), true);
select set_config('test.off_id', (select id::text from app.operators where name = 'Spento Accesso Operatori'), true);
select set_config('test.offadmin_id',
  (select id::text from app.operators where name = 'Admin Spento Accesso Operatori'), true);
select set_config('test.device_id', (select id::text from app.devices where name = 'Tablet Accesso Operatori'), true);

-- One row in every table and view of app, so 0 rows below means hidden, not empty. The
-- movements are the deactivated operator's: its history must survive everything below.
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
values ('00000000-0000-4000-d100-000000000001', 'Cliente Accesso Operatori', now(),
  current_setting('test.off_id')::uuid, '00000000-0000-4000-d200-000000000001');
insert into app.cards (uid, customer_id, associated_by)
values ('D0B1C2D3E4F5A6', '00000000-0000-4000-d100-000000000001', current_setting('test.off_id')::uuid);
insert into app.rewards (id, name, points, created_by, updated_by)
values ('00000000-0000-4000-d300-000000000001', 'Caffè Accesso Operatori', 1,
  current_setting('test.admin_id')::uuid, current_setting('test.admin_id')::uuid);
insert into app.movements
  (id, operation_id, customer_id, kind, amount_cents, points, cents_per_point, operator_id)
values
  ('00000000-0000-4000-d400-000000000001', '00000000-0000-4000-d200-000000000002',
   '00000000-0000-4000-d100-000000000001', 'purchase', 5000, 50, 100, current_setting('test.off_id')::uuid),
  ('00000000-0000-4000-d400-000000000002', '00000000-0000-4000-d200-000000000003',
   '00000000-0000-4000-d100-000000000001', 'purchase', 1290, 12, 100, current_setting('test.off_id')::uuid);

-- The history of the deactivated operator, as 'count:sum of points' (read as postgres).
create function pg_temp.off_history()
returns text
language sql
as $$
  select count(*)::text || ':' || coalesce(sum(points), 0)::text
  from app.movements where operator_id = current_setting('test.off_id')::uuid;
$$;
select set_config('test.history', pg_temp.off_history(), true);

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

-- Every write RPC of app with the code it already uses for "no operator" (the same list
-- as tablet_kiosk_access.test.sql, plus set_my_pin, which a deactivated account must not
-- reach either). The read RPCs are refused the same way.
create temp table rpc_calls (name text primary key, kind text, call text, errcode text, message text);
insert into rpc_calls values
  ('list_customers', 'read', $$select * from app.list_customers()$$, 'P0001', 'not_operator'),
  ('get_customer', 'read',
   $$select * from app.get_customer('00000000-0000-4000-d100-000000000001')$$, 'P0001', 'not_operator'),
  ('lookup_card', 'read', $$select * from app.lookup_card('D0B1C2D3E4F5A6')$$, 'P0001', 'not_operator'),
  ('get_card', 'read',
   $$select * from app.get_card((select id from app.cards where uid = 'D0B1C2D3E4F5A6'))$$,
   'P0001', 'not_operator'),
  ('export_customers', 'read', $$select * from app.export_customers(null, 10)$$, '42501', 'forbidden'),
  ('export_movements', 'read', $$select * from app.export_movements(null, null, 10)$$, '42501', 'forbidden'),
  ('create_customer', 'write',
   $$select app.create_customer(gen_random_uuid(), 'Nuovo Accesso Operatori', null, true, null)$$,
   'P0001', 'not_operator'),
  ('create_customer_with_card', 'write',
   $$select app.create_customer_with_card(gen_random_uuid(), 'Nuovo Card Accesso Operatori', null, true,
     null, 'D0B1C2D3E4F5A7')$$,
   'P0001', 'not_operator'),
  ('update_customer', 'write',
   $$select app.update_customer('00000000-0000-4000-d100-000000000001', 'Cliente Accesso Due', null, null)$$,
   'P0001', 'not_operator'),
  ('anonymize_customer', 'write',
   $$select app.anonymize_customer('00000000-0000-4000-d100-000000000001')$$, 'P0001', 'not_operator'),
  ('associate_card', 'write',
   $$select app.associate_card('00000000-0000-4000-d100-000000000001', 'D0B1C2D3E4F5A8')$$,
   'P0001', 'not_operator'),
  ('release_card', 'write',
   $$select app.release_card(gen_random_uuid(), (select id from app.cards where uid = 'D0B1C2D3E4F5A6'))$$,
   'P0001', 'not_operator'),
  ('reactivate_card', 'write',
   $$select app.reactivate_card((select id from app.cards where uid = 'D0B1C2D3E4F5A6'), null)$$,
   'P0001', 'not_operator'),
  ('deactivate_card', 'write',
   $$select app.deactivate_card((select id from app.cards where uid = 'D0B1C2D3E4F5A6'))$$,
   'P0001', 'not_operator'),
  ('issue_card_link', 'write',
   $$select app.issue_card_link(gen_random_uuid())$$, 'P0001', 'not_operator'),
  ('confirm_card_link', 'write',
   $$select app.confirm_card_link(gen_random_uuid(), 'token')$$, 'P0001', 'not_operator'),
  ('create_reward', 'write',
   $$select app.create_reward(gen_random_uuid(), 'Premio Accesso Operatori', 5, true)$$,
   '42501', 'Only an admin can change the rewards'),
  ('update_reward', 'write',
   $$select app.update_reward('00000000-0000-4000-d300-000000000001', 'Caffè Accesso Due', 2)$$,
   '42501', 'Only an admin can change the rewards'),
  ('set_reward_active', 'write',
   $$select app.set_reward_active('00000000-0000-4000-d300-000000000001', false)$$,
   '42501', 'Only an admin can change the rewards'),
  ('record_purchase', 'write',
   $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-d100-000000000001', 1250)$$,
   '42501', 'No acting operator for this write'),
  ('redeem_reward', 'write',
   $$select app.redeem_reward(gen_random_uuid(), '00000000-0000-4000-d100-000000000001',
     '00000000-0000-4000-d300-000000000001')$$,
   '42501', 'No acting operator for this write'),
  ('redeem_free_reward', 'write',
   $$select app.redeem_free_reward(gen_random_uuid(), '00000000-0000-4000-d100-000000000001',
     'Cornetto', 1)$$,
   '42501', 'No acting operator for this write'),
  ('cancel_movement', 'write',
   $$select app.cancel_movement(gen_random_uuid(), '00000000-0000-4000-d400-000000000001')$$,
   '42501', 'No acting operator for this write'),
  ('list_operators', 'read', $$select * from app.list_operators()$$, '42501',
   'Only an admin can list the operators'),
  ('set_operator_role', 'write',
   $$select * from app.set_operator_role('00000000-0000-4000-0000-0000000000ff', 'operator')$$,
   '42501', 'Only an admin can change the operators'),
  ('set_operator_active', 'write',
   $$select * from app.set_operator_active('00000000-0000-4000-0000-0000000000ff', false)$$,
   '42501', 'Only an admin can change the operators'),
  ('update_settings', 'write',
   $$select app.update_settings(100, 15000, null)$$, '42501', 'Only an admin can change the settings'),
  ('set_my_pin', 'write',
   $$select app.set_my_pin('4321')$$, '42501', 'Only an operator account can set its own PIN');
grant select on rpc_calls to authenticated;

-- The new columns --------------------------------------------------------------------------
select is(
  array(
    select a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || (not a.attnotnull)::text
    from pg_attribute a
    where a.attrelid = 'app.operators'::regclass
      and a.attname in ('deactivated_at', 'deactivated_by', 'invited_at', 'invited_by')
    order by a.attname
  ),
  array['deactivated_at:timestamp with time zone:true', 'deactivated_by:uuid:true',
        'invited_at:timestamp with time zone:true', 'invited_by:uuid:true'],
  'app.operators has the nullable columns deactivated_at/_by and invited_at/_by'
);
select is(
  array(
    select a.attname::text || '->' || c.confrelid::regclass::text
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'app.operators'::regclass and c.contype = 'f'
      and a.attname in ('deactivated_by', 'invited_by')
    order by 1
  ),
  array['deactivated_by->app.operators', 'invited_by->app.operators'],
  'deactivated_by and invited_by reference app.operators'
);
select throws_ok(
  format($$update app.operators set deactivated_at = now() where id = %L$$, current_setting('test.off_id')),
  '23514', null,
  'deactivated_at without deactivated_by is rejected'
);
select throws_ok(
  format($$update app.operators set deactivated_by = %L where id = %L$$,
    current_setting('test.admin_id'), current_setting('test.off_id')),
  '23514', null,
  'deactivated_by without deactivated_at is rejected'
);

-- Before: the operator and the admin work normally -------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(private.current_operator_id(), current_setting('test.off_id')::uuid,
  'precondition: the operator account is its profile');
select ok((select count(*) from app.customers) > 0, 'precondition: the operator reads the customers');
reset role;

-- Deactivated: nothing at all ---------------------------------------------------------------
-- Written by the test as postgres (set_operator_active comes in task 2).
update app.operators
set deactivated_at = now(), deactivated_by = current_setting('test.admin_id')::uuid
where id in (current_setting('test.off_id')::uuid, current_setting('test.offadmin_id')::uuid);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000002","role":"authenticated"}', true);
select is(private.current_operator_id(), null, 'a deactivated operator has no current operator');
select is(private.acting_operator_id(), null, 'a deactivated operator has no acting operator');
set local role authenticated;
select ok(not private.is_active_operator(), 'a deactivated operator is not an active operator');
select is(app.get_session_identity(), null, 'a deactivated operator has no session identity');
select is(
  array(select pg_temp.app_row_counts()),
  current_setting('test.hidden')::text[],
  'a deactivated operator gets 0 rows from every table and view of app'
);
select throws_ok(r.call, r.errcode, r.message,
  'a deactivated operator: ' || r.name || ' is refused as for a caller without an operator')
from rpc_calls r order by r.kind, r.name;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select ok(not private.is_admin(), 'a deactivated admin is not an admin');
select is(app.get_session_identity(), null, 'a deactivated admin has no session identity');
select is(
  array(select pg_temp.app_row_counts()),
  current_setting('test.hidden')::text[],
  'a deactivated admin gets 0 rows from every table and view of app'
);
reset role;

-- As a cashier: not listed, not unlocked, an open turn gives nothing --------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*) from app.list_cashiers() c where c.name like '%Accesso Operatori'),
  1::bigint,
  'the deactivated operator and admin are not in the list of cashiers'
);
select is(
  app.unlock_cashier(current_setting('test.off_id')::uuid, '1234'),
  '{"status":"no_pin"}'::jsonb,
  'unlock_cashier answers no_pin for a deactivated operator, even with the right PIN'
);
select is(
  app.unlock_cashier(current_setting('test.offadmin_id')::uuid, '1234'),
  '{"status":"no_pin"}'::jsonb,
  'unlock_cashier answers no_pin for a deactivated admin'
);
reset role;
select is(
  (select row(cashier_operator_id, failed_pin_attempts)::text from app.devices
   where id = current_setting('test.device_id')::uuid),
  row(null::uuid, 0)::text,
  'no_pin opens no turn and counts no wrong PIN'
);

-- A turn opened before the deactivation (punto 7: the guarantee is valid_cashier_id).
update app.devices
set cashier_operator_id = current_setting('test.off_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;
select is(private.valid_cashier_id(), null, 'a deactivated cashier is not a valid cashier');
select is(private.acting_operator_id(), null, 'a device with a deactivated cashier has no acting operator');
set local role authenticated;
select ok(not private.is_active_operator(), 'a device with a deactivated cashier is not an active operator');
select is(
  app.get_session_identity() -> 'cashier',
  'null'::jsonb,
  'the identity of a device with a deactivated cashier has no cashier'
);
select is(
  array(select pg_temp.app_row_counts()),
  current_setting('test.hidden')::text[],
  'a device with a deactivated cashier gets 0 rows from every table and view of app'
);
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-d100-000000000001', 1250)$$,
  '42501',
  'No acting operator for this write',
  'a device with a deactivated cashier cannot record a purchase'
);
reset role;

update app.devices
set cashier_operator_id = current_setting('test.offadmin_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;
set local role authenticated;
select ok(not private.is_admin(), 'a device with a deactivated admin cashier is not an admin');
reset role;

select is(pg_temp.off_history(), current_setting('test.history'),
  'deactivating changes neither the count nor the sum of the movements');

-- Reactivated by clearing deactivated_at: everything is back ---------------------------------
update app.operators
set deactivated_at = null, deactivated_by = null
where id in (current_setting('test.off_id')::uuid, current_setting('test.offadmin_id')::uuid);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000004","role":"authenticated"}', true);
select is(private.valid_cashier_id(), current_setting('test.offadmin_id')::uuid,
  'the turn of a reactivated cashier is valid again');
set local role authenticated;
select ok(private.is_admin(), 'a device with a reactivated admin cashier is an admin again');
select is(
  app.get_session_identity() -> 'cashier' ->> 'id',
  current_setting('test.offadmin_id'),
  'the identity of the device shows the reactivated cashier'
);
select is(
  (select count(*) from app.list_cashiers() c where c.name like '%Accesso Operatori'),
  3::bigint,
  'the reactivated operator and admin are in the list of cashiers again'
);
select is(
  app.unlock_cashier(current_setting('test.off_id')::uuid, '1234') ->> 'status',
  'ok',
  'unlock_cashier unlocks the reactivated operator'
);
select ok((select count(*) from app.customers) > 0, 'the device reads again with the reactivated cashier');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000002","role":"authenticated"}', true);
select is(private.current_operator_id(), current_setting('test.off_id')::uuid,
  'the reactivated operator is its profile again');
set local role authenticated;
select ok(private.is_active_operator(), 'the reactivated operator is an active operator again');
select is(
  app.get_session_identity(),
  jsonb_build_object('kind', 'operator', 'operator', jsonb_build_object(
    'id', current_setting('test.off_id')::uuid, 'name', 'Spento Accesso Operatori',
    'role', 'operator', 'has_pin', true)),
  'the reactivated operator has its session identity again'
);
select is(
  array(select r from pg_temp.app_row_counts() r where r like '%:0'),
  array[]::text[],
  'the reactivated operator reads every table and view of app again'
);
select lives_ok(
  $$select app.record_purchase('00000000-0000-4000-d200-000000000010',
    '00000000-0000-4000-d100-000000000001', 1000)$$,
  'the reactivated operator records a purchase again'
);
reset role;
select is(
  (select operator_id from app.movements where operation_id = '00000000-0000-4000-d200-000000000010'),
  current_setting('test.off_id')::uuid,
  'the purchase of the reactivated operator is recorded with its profile'
);
-- Movements are append-only: the history compared below now includes this purchase.
select set_config('test.history', pg_temp.off_history(), true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select ok(private.is_admin(), 'the reactivated admin is an admin again');
reset role;

-- add_operator reactivates a deactivated profile ---------------------------------------------
update app.operators
set deactivated_at = now(), deactivated_by = current_setting('test.admin_id')::uuid
where id = current_setting('test.off_id')::uuid;

select is(
  private.add_operator('op.access.off@example.com', 'Spento Accesso Operatori', 'operator'),
  current_setting('test.off_id')::uuid,
  'add_operator on a deactivated profile with the same account returns that profile'
);
select is(
  (select row(deactivated_at, deactivated_by, user_id)::text from app.operators
   where id = current_setting('test.off_id')::uuid),
  row(null::timestamptz, null::uuid, '00000000-0000-4000-d000-000000000002'::uuid)::text,
  'add_operator clears deactivated_at and deactivated_by'
);
select is(pg_temp.off_history(), current_setting('test.history'),
  'reactivating with add_operator changes neither the count nor the sum of the movements');

-- The "rimettere un operatore" procedure: account deleted while deactivated, then a new one
-- relinked to the profile with the same name.
update app.operators
set deactivated_at = now(), deactivated_by = current_setting('test.admin_id')::uuid
where id = current_setting('test.off_id')::uuid;
insert into private.operator_pins (operator_id, pin_hash)
values (current_setting('test.off_id')::uuid, extensions.crypt('4321', extensions.gen_salt('bf', 4)))
on conflict (operator_id) do nothing;
delete from auth.users where id = '00000000-0000-4000-d000-000000000002';
insert into auth.users (id, email) values
  ('00000000-0000-4000-d000-000000000005', 'op.access.back@example.com');
select is(
  private.add_operator('op.access.back@example.com', 'spento accesso operatori', 'admin'),
  current_setting('test.off_id')::uuid,
  'add_operator relinks a removed and deactivated profile with the same name'
);
select is(
  (select row(deactivated_at, deactivated_by, user_id, role)::text from app.operators
   where id = current_setting('test.off_id')::uuid),
  row(null::timestamptz, null::uuid, '00000000-0000-4000-d000-000000000005'::uuid, 'admin')::text,
  'the relinked profile is active, with the new account and role'
);
select is(pg_temp.off_history(), current_setting('test.history'),
  'relinking changes neither the count nor the sum of the movements');
select is(
  (select count(*)::int from private.operator_pins where operator_id = current_setting('test.off_id')::uuid),
  0, 'relinking a removed profile to a new account drops the PIN of the old one');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select ok(private.is_admin(), 'the new account of the relinked profile works');
reset role;

-- Same signatures, attributes and privileges as before ---------------------------------------
select is(
  array(
    select p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':'
      || coalesce(array_to_string(p.proconfig, ','), '') || ':' || pg_get_function_result(p.oid)
    from pg_proc p
    where p.oid in ('private.current_operator_id()'::regprocedure,
                    'private.valid_cashier_id()'::regprocedure,
                    'app.get_session_identity()'::regprocedure,
                    'app.list_cashiers()'::regprocedure,
                    'app.unlock_cashier(uuid, text)'::regprocedure,
                    'private.add_operator(text, text, text)'::regprocedure)
    order by 1
  ),
  array['app.get_session_identity():true:v:search_path="":jsonb',
        'app.list_cashiers():true:s:search_path="":TABLE(id uuid, name text, role text, has_pin boolean)',
        'app.unlock_cashier(uuid,text):true:v:search_path="":jsonb',
        'private.add_operator(text,text,text):false:v:search_path="":uuid',
        'private.current_operator_id():true:s:search_path="":uuid',
        'private.valid_cashier_id():true:s:search_path="":uuid'],
  'the redefined functions keep signature, security, volatility and an empty search_path'
);
select is(
  array(
    select f.fn || ':' || r.role || ':' || has_function_privilege(r.role, f.fn, 'execute')::text
    from (values ('anon'), ('authenticated'), ('service_role')) r (role)
    cross join (values ('private.current_operator_id()'), ('private.valid_cashier_id()'),
                       ('app.get_session_identity()'), ('app.list_cashiers()'),
                       ('app.unlock_cashier(uuid, text)'), ('private.add_operator(text, text, text)')) f (fn)
    where r.role <> 'service_role' or f.fn = 'private.add_operator(text, text, text)'
    order by 1
  ),
  array['app.get_session_identity():anon:false', 'app.get_session_identity():authenticated:true',
        'app.list_cashiers():anon:false', 'app.list_cashiers():authenticated:true',
        'app.unlock_cashier(uuid, text):anon:false', 'app.unlock_cashier(uuid, text):authenticated:true',
        'private.add_operator(text, text, text):anon:false',
        'private.add_operator(text, text, text):authenticated:false',
        'private.add_operator(text, text, text):service_role:false',
        'private.current_operator_id():anon:false', 'private.current_operator_id():authenticated:true',
        'private.valid_cashier_id():anon:false', 'private.valid_cashier_id():authenticated:false'],
  'the redefined functions keep their privileges'
);

-- The seed accounts reserved to the operators E2E (applied by db reset before the tests) ------
select is(
  array(
    select u.email || ':' || o.name || ':' || o.role || ':' || (p.operator_id is not null)::text
      || ':' || (o.deactivated_at is null)::text
    from app.operators o
    join auth.users u on u.id = o.user_id
    left join private.operator_pins p on p.operator_id = o.id
    where u.email in ('disattiva@example.com', 'ruolo@example.com', 'admin-operatori@example.com')
    order by u.email
  ),
  array['admin-operatori@example.com:Admin Operatori:admin:true:true',
        'disattiva@example.com:Disattiva Prova:operator:true:true',
        'ruolo@example.com:Ruolo Prova:operator:true:true'],
  'the seed has the reserved operators, active and with a fake PIN'
);
select is(
  (select d.name from app.devices d join auth.users u on u.id = d.user_id
   where u.email = 'cassa-operatori@example.com'),
  'Tablet operatori',
  'the seed links cassa-operatori@ to "Tablet operatori"'
);
select is(
  (select count(*) from auth.users u
   join auth.identities i on i.user_id = u.id
   where u.email in ('disattiva@example.com', 'ruolo@example.com', 'admin-operatori@example.com',
                     'cassa-operatori@example.com')
     and u.email_confirmed_at is not null
     and u.encrypted_password = extensions.crypt('password-di-prova', u.encrypted_password)),
  4::bigint,
  'the reserved seed accounts are confirmed, use the seed password and can sign in'
);

select * from finish();
rollback;
