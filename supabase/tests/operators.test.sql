-- operators: the list of people, the change of role, deactivation and reactivation
-- (SPEC-operators.md points 2 and 7, "Modello dati e regole di accesso"). Only an admin
-- (an admin account, or a device with an admin cashier) lists and changes profiles; nobody
-- changes their own; a profile without an account cannot be changed; an admin is never
-- named from a device; the bar never loses its last admin with an accepted invite.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

-- Fake Auth users. Accepted invite = email confirmed and a password; the others are invited.
insert into auth.users (id, email, email_confirmed_at, encrypted_password) values
  ('00000000-0000-4000-d500-000000000001', 'op.list.admin@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d500-000000000002', 'op.list.admin2@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d500-000000000003', 'op.list.operator@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d500-000000000004', 'op.list.unconfirmed@example.com', null, null),
  ('00000000-0000-4000-d500-000000000005', 'op.list.nopassword@example.com', now(), ''),
  ('00000000-0000-4000-d500-000000000006', 'op.list.off@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d500-000000000007', 'op.list.removed@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d500-000000000008', 'op.list.invitedadmin@example.com', now(), null),
  ('00000000-0000-4000-d500-000000000011', 'op.list.device@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d500-000000000012', 'op.list.device2@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d500-000000000013', 'op.list.device3@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4)));
select private.add_operator('op.list.admin@example.com', 'alfa Elenco Operatori', 'admin');
select private.add_operator('op.list.admin2@example.com', 'Beta Elenco Operatori', 'admin');
select private.add_operator('op.list.operator@example.com', 'Gamma Elenco Operatori', 'operator');
select private.add_operator('op.list.unconfirmed@example.com', 'Delta Elenco Operatori', 'operator');
select private.add_operator('op.list.nopassword@example.com', 'Epsilon Elenco Operatori', 'operator');
select private.add_operator('op.list.off@example.com', 'Aaa Spento Elenco Operatori', 'operator');
select private.add_operator('op.list.removed@example.com', 'Aab Rimosso Elenco Operatori', 'operator');
select private.add_operator('op.list.invitedadmin@example.com', 'Zeta Elenco Operatori', 'admin');
select private.add_device('op.list.device@example.com', 'Tablet Elenco Operatori');
select private.add_device('op.list.device2@example.com', 'Tablet Due Elenco Operatori');
select private.add_device('op.list.device3@example.com', 'Tablet Tre Elenco Operatori');

create function pg_temp.op(p_name text)
returns uuid
language sql
as $$
  select id from app.operators where name = p_name || ' Elenco Operatori';
$$;
grant execute on function pg_temp.op(text) to authenticated;

-- Fake PINs for the admin and the operator (the cashiers below); the others have none.
insert into private.operator_pins (operator_id, pin_hash)
select id, extensions.crypt('1234', extensions.gen_salt('bf', 4))
from app.operators where id in (pg_temp.op('alfa'), pg_temp.op('Gamma'));

-- Deactivated and removed (account deleted from the panel: user_id set null).
update app.operators set deactivated_at = now(), deactivated_by = pg_temp.op('alfa')
where id = pg_temp.op('Aaa Spento');
delete from auth.users where id = '00000000-0000-4000-d500-000000000007';

-- Devices: one with the admin cashier, one with the operator cashier, one without.
update app.devices set cashier_operator_id = pg_temp.op('alfa'), cashier_since = now()
where name = 'Tablet Elenco Operatori';
update app.devices set cashier_operator_id = pg_temp.op('Gamma'), cashier_since = now()
where name = 'Tablet Due Elenco Operatori';

-- The operator's history, which nothing below may change.
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
values ('00000000-0000-4000-d600-000000000001', 'Cliente Elenco Operatori', now(),
  pg_temp.op('Gamma'), '00000000-0000-4000-d600-000000000002');
insert into app.movements
  (id, operation_id, customer_id, kind, amount_cents, points, cents_per_point, operator_id)
values
  ('00000000-0000-4000-d600-000000000003', '00000000-0000-4000-d600-000000000004',
   '00000000-0000-4000-d600-000000000001', 'purchase', 2550, 25, 100, pg_temp.op('Gamma'));
create function pg_temp.history()
returns text
language sql
as $$
  select count(*)::text || ':' || coalesce(sum(points), 0)::text
  from app.movements where operator_id = pg_temp.op('Gamma');
$$;
select set_config('test.history', pg_temp.history(), true);

-- Callers.
create function pg_temp.as_user(p_sub text)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', p_sub), true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- The rows of this test, in the order of list_operators, as 'name|role|status|email|has_pin|is_me'.
create function pg_temp.listed()
returns setof text
language sql
as $$
  select concat_ws('|', l.name, l.role, l.status, coalesce(l.email, '-'), l.has_pin, l.is_me)
  from app.list_operators() l
  where l.name like '% Elenco Operatori';
$$;
grant execute on function pg_temp.listed() to authenticated;

-- list_operators: admins only ------------------------------------------------------------------
select has_function('app', 'list_operators', array[]::text[], 'app.list_operators() exists');
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
   where p.oid = 'app.list_operators()'::regprocedure),
  true,
  'list_operators is security definer with an empty search_path'
);

select pg_temp.as_user('00000000-0000-4000-d500-000000000003');
set local role authenticated;
select throws_ok($$select * from app.list_operators()$$, '42501', null,
  'an operator account cannot list the operators');
reset role;
select pg_temp.as_user('00000000-0000-4000-d500-000000000013');
set local role authenticated;
select throws_ok($$select * from app.list_operators()$$, '42501', null,
  'a device without a cashier cannot list the operators');
reset role;
select pg_temp.as_user('00000000-0000-4000-d500-000000000012');
set local role authenticated;
select throws_ok($$select * from app.list_operators()$$, '42501', null,
  'a device with an operator cashier cannot list the operators');
reset role;
select pg_temp.as_user('00000000-0000-4000-d500-000000000006');
set local role authenticated;
select throws_ok($$select * from app.list_operators()$$, '42501', null,
  'a deactivated account cannot list the operators');
reset role;
set local role anon;
select throws_ok($$select * from app.list_operators()$$, '42501', null,
  'anon cannot execute list_operators');
reset role;

select pg_temp.as_user('00000000-0000-4000-d500-000000000001');
set local role authenticated;
select is(
  array(select pg_temp.listed()),
  array[
    'alfa Elenco Operatori|admin|active|op.list.admin@example.com|t|t',
    'Beta Elenco Operatori|admin|active|op.list.admin2@example.com|f|f',
    'Delta Elenco Operatori|operator|invited|op.list.unconfirmed@example.com|f|f',
    'Epsilon Elenco Operatori|operator|invited|op.list.nopassword@example.com|f|f',
    'Gamma Elenco Operatori|operator|active|op.list.operator@example.com|t|f',
    'Zeta Elenco Operatori|admin|invited|op.list.invitedadmin@example.com|f|f',
    'Aaa Spento Elenco Operatori|operator|deactivated|op.list.off@example.com|f|f',
    'Aab Rimosso Elenco Operatori|operator|removed|-|f|f'
  ],
  'an admin lists the four states, case-insensitive by name, deactivated and removed last, is_me on itself'
);
select is(
  (select count(*) from app.list_operators() l where l.name like 'Tablet%Elenco Operatori'),
  0::bigint,
  'devices are not listed'
);
select is(
  (select array_agg(p.parameter_name::text order by p.ordinal_position)
   from information_schema.parameters p
   join information_schema.routines r on r.specific_name = p.specific_name
   where r.routine_schema = 'app' and r.routine_name = 'list_operators' and p.parameter_mode = 'OUT'),
  array['id', 'name', 'role', 'status', 'email', 'has_pin', 'is_me'],
  'list_operators returns id, name, role, status, email, has_pin, is_me: never a hash or a token'
);
reset role;

select pg_temp.as_user('00000000-0000-4000-d500-000000000011');
set local role authenticated;
select is(
  (select string_agg(l.name, ',') from app.list_operators() l where l.is_me),
  'alfa Elenco Operatori',
  'a device with an admin cashier lists the operators, is_me on the cashier'
);
reset role;

-- set_operator_role / set_operator_active: who may call them -----------------------------------
select has_function('app', 'set_operator_role', array['uuid', 'text'], 'app.set_operator_role(uuid, text) exists');
select has_function('app', 'set_operator_active', array['uuid', 'boolean'],
  'app.set_operator_active(uuid, boolean) exists');
select is(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
   where p.oid in ('app.set_operator_role(uuid, text)'::regprocedure,
                   'app.set_operator_active(uuid, boolean)'::regprocedure)),
  true,
  'set_operator_role and set_operator_active are security definer with an empty search_path'
);

select pg_temp.as_user('00000000-0000-4000-d500-000000000003');
set local role authenticated;
select throws_ok(format($$select * from app.set_operator_role(%L, 'admin')$$, pg_temp.op('Delta')),
  '42501', null, 'an operator cannot change a role');
select throws_ok(format($$select * from app.set_operator_active(%L, false)$$, pg_temp.op('Delta')),
  '42501', null, 'an operator cannot deactivate');
select throws_ok(format($$select * from app.set_operator_role(%L, 'admin')$$, gen_random_uuid()),
  '42501', null, 'an operator gets 42501 before P0002');
reset role;
select pg_temp.as_user('00000000-0000-4000-d500-000000000013');
set local role authenticated;
select throws_ok(format($$select * from app.set_operator_role(%L, 'operator')$$, pg_temp.op('Beta')),
  '42501', null, 'a device without a cashier cannot change a role');
select throws_ok(format($$select * from app.set_operator_active(%L, false)$$, pg_temp.op('Beta')),
  '42501', null, 'a device without a cashier cannot deactivate');
reset role;
select pg_temp.as_user('00000000-0000-4000-d500-000000000012');
set local role authenticated;
select throws_ok(format($$select * from app.set_operator_role(%L, 'operator')$$, pg_temp.op('Beta')),
  '42501', null, 'a device with an operator cashier cannot change a role');
select throws_ok(format($$select * from app.set_operator_active(%L, false)$$, pg_temp.op('Beta')),
  '42501', null, 'a device with an operator cashier cannot deactivate');
reset role;
select set_config('test.beta_id', pg_temp.op('Beta')::text, true);
set local role anon;
select throws_ok(format($$select * from app.set_operator_role(%L, 'operator')$$, current_setting('test.beta_id')),
  '42501', null, 'anon cannot execute set_operator_role');
select throws_ok(format($$select * from app.set_operator_active(%L, false)$$, current_setting('test.beta_id')),
  '42501', null, 'anon cannot execute set_operator_active');
reset role;

-- Admin: not found, self, removed, invalid values ----------------------------------------------
select pg_temp.as_user('00000000-0000-4000-d500-000000000001');
set local role authenticated;
select throws_ok(format($$select * from app.set_operator_role(%L, 'admin')$$, gen_random_uuid()),
  'P0002', null, 'an unknown profile is P0002 (role)');
select throws_ok(format($$select * from app.set_operator_active(%L, false)$$, gen_random_uuid()),
  'P0002', null, 'an unknown profile is P0002 (active)');
select throws_ok(format($$select * from app.set_operator_role(%L, 'operator')$$, pg_temp.op('alfa')),
  'EO002', null, 'an admin cannot change its own role');
select throws_ok(format($$select * from app.set_operator_active(%L, false)$$, pg_temp.op('alfa')),
  'EO002', null, 'an admin cannot deactivate itself');
select throws_ok(format($$select * from app.set_operator_role(%L, 'admin')$$, pg_temp.op('alfa')),
  'EO002', null, 'EO002 also for the role it already has');
select throws_ok(format($$select * from app.set_operator_role(%L, 'admin')$$, pg_temp.op('Aab Rimosso')),
  'EO003', null, 'a removed profile has no role to change');
select throws_ok(format($$select * from app.set_operator_active(%L, true)$$, pg_temp.op('Aab Rimosso')),
  'EO003', null, 'a removed profile cannot be reactivated');
select throws_ok(format($$select * from app.set_operator_active(%L, false)$$, pg_temp.op('Aab Rimosso')),
  'EO003', null, 'a removed profile cannot be deactivated');
select throws_ok(format($$select * from app.set_operator_role(%L, 'boss')$$, pg_temp.op('Delta')),
  '22023', null, 'an unknown role is 22023');
select throws_ok(format($$select * from app.set_operator_role(%L, null)$$, pg_temp.op('Delta')),
  '22023', null, 'a null role is 22023');
select throws_ok(format($$select * from app.set_operator_active(%L, null)$$, pg_temp.op('Delta')),
  '22023', null, 'a null active is 22023');

-- Role: change, idempotence, shape -------------------------------------------------------------
select set_config('test.returned',
  (select row(r.*)::text from app.set_operator_role(pg_temp.op('Delta'), 'admin') r), true);
select is(
  (select row(l.*)::text from app.list_operators() l where l.id = pg_temp.op('Delta')),
  current_setting('test.returned'),
  'set_operator_role returns the updated profile in the shape of list_operators'
);
select is(
  (select r.role || '|' || r.status from app.set_operator_role(pg_temp.op('Delta'), 'admin') r),
  'admin|invited',
  'set_operator_role to the same role answers the same (idempotent)'
);
select is(
  (select r.role from app.set_operator_role(pg_temp.op('Delta'), 'operator') r),
  'operator',
  'an admin turns an admin back into an operator'
);
reset role;
select is((select role from app.operators where id = pg_temp.op('Delta')), 'operator',
  'the role is written');

-- Deactivation: turns closed on every tablet, PIN kept, history unchanged ---------------------
-- The operator Gamma is the cashier of the second tablet and, here, of the third one too.
update app.devices set cashier_operator_id = pg_temp.op('Gamma'), cashier_since = now()
where name = 'Tablet Tre Elenco Operatori';
select pg_temp.as_user('00000000-0000-4000-d500-000000000001');
set local role authenticated;
select is(
  (select r.status from app.set_operator_active(pg_temp.op('Gamma'), false) r),
  'deactivated',
  'an admin deactivates an operator'
);
select is(
  (select row(r.*)::text from app.set_operator_active(pg_temp.op('Gamma'), false) r),
  (select row(l.*)::text from app.list_operators() l where l.id = pg_temp.op('Gamma')),
  'set_operator_active returns the profile in the shape of list_operators'
);
reset role;
select is(
  (select deactivated_by from app.operators where id = pg_temp.op('Gamma')),
  pg_temp.op('alfa'),
  'deactivated_by is the admin who deactivated'
);
select is(
  (select count(*) from app.devices where cashier_operator_id = pg_temp.op('Gamma') or
     (name in ('Tablet Due Elenco Operatori', 'Tablet Tre Elenco Operatori') and cashier_since is not null)),
  0::bigint,
  'deactivating closes the till turns of that person on every tablet'
);
select is(
  (select cashier_operator_id from app.devices where name = 'Tablet Elenco Operatori'),
  pg_temp.op('alfa'),
  'the turns of other people stay open'
);
select ok(exists (select 1 from private.operator_pins where operator_id = pg_temp.op('Gamma')),
  'the PIN stays, for the reactivation');
select is(pg_temp.history(), current_setting('test.history'),
  'deactivating changes neither the count nor the sum of the movements');

-- Deactivating again (from the other admin) changes nothing.
select set_config('test.deactivated_at',
  (select deactivated_at::text from app.operators where id = pg_temp.op('Gamma')), true);
select pg_temp.as_user('00000000-0000-4000-d500-000000000002');
set local role authenticated;
select is(
  (select r.status from app.set_operator_active(pg_temp.op('Gamma'), false) r),
  'deactivated',
  'deactivating a deactivated profile answers the same (idempotent)'
);
reset role;
select is(
  (select deactivated_at::text || '|' || (deactivated_by = pg_temp.op('alfa')) from app.operators
   where id = pg_temp.op('Gamma')),
  current_setting('test.deactivated_at') || '|true',
  'a second deactivation writes nothing'
);

-- Reactivation.
select pg_temp.as_user('00000000-0000-4000-d500-000000000001');
set local role authenticated;
select is(
  (select r.status from app.set_operator_active(pg_temp.op('Gamma'), true) r),
  'active',
  'an admin reactivates a deactivated operator, who is active again'
);
select is(
  (select r.status from app.set_operator_active(pg_temp.op('Gamma'), true) r),
  'active',
  'reactivating an active profile answers the same (idempotent)'
);
select is(
  (select r.status from app.set_operator_active(pg_temp.op('Delta'), false) r),
  'deactivated',
  'an invited profile can be deactivated'
);
select is(
  (select r.status from app.set_operator_active(pg_temp.op('Delta'), true) r),
  'invited',
  'reactivating someone who never accepted gives back invited'
);
reset role;
select is(
  (select row(deactivated_at, deactivated_by)::text from app.operators where id = pg_temp.op('Gamma')),
  row(null::timestamptz, null::uuid)::text,
  'reactivating clears deactivated_at and deactivated_by'
);
select is(pg_temp.history(), current_setting('test.history'),
  'reactivating changes neither the count nor the sum of the movements');

-- From a device with an admin cashier ----------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-d500-000000000011');
set local role authenticated;
select throws_ok(format($$select * from app.set_operator_role(%L, 'admin')$$, pg_temp.op('Gamma')),
  'EO005', null, 'an admin cashier cannot name an admin from a device');
select throws_ok(format($$select * from app.set_operator_role(%L, 'admin')$$, pg_temp.op('Beta')),
  'EO005', null, 'EO005 even for someone who is already an admin');
select throws_ok(format($$select * from app.set_operator_role(%L, 'operator')$$, pg_temp.op('alfa')),
  'EO002', null, 'the admin cashier cannot change itself');
select throws_ok(format($$select * from app.set_operator_active(%L, false)$$, pg_temp.op('alfa')),
  'EO002', null, 'the admin cashier cannot deactivate itself');
select is(
  (select r.role from app.set_operator_role(pg_temp.op('Zeta'), 'operator') r),
  'operator',
  'an admin cashier can turn an admin into an operator'
);
select is(
  (select r.status from app.set_operator_active(pg_temp.op('Epsilon'), false) r),
  'deactivated',
  'an admin cashier can deactivate'
);
reset role;
select is(
  (select deactivated_by from app.operators where id = pg_temp.op('Epsilon')),
  pg_temp.op('alfa'),
  'from a device, deactivated_by is the cashier'
);
select is((select role from app.operators where id = pg_temp.op('Gamma')), 'operator',
  'EO005 wrote nothing');

-- The last admin (EO001) -----------------------------------------------------------------------
-- Only the admins of this test are left: the seed admins become operators for this transaction.
update app.operators set role = 'operator'
where role = 'admin' and name not like '% Elenco Operatori';
update app.operators set role = 'admin' where id = pg_temp.op('Zeta');
-- Caller: Zeta, an admin who opened the invite link but never saved a password (invited).
select pg_temp.as_user('00000000-0000-4000-d500-000000000008');
set local role authenticated;
select is(
  (select r.role from app.set_operator_role(pg_temp.op('Beta'), 'operator') r),
  'operator',
  'an admin can be demoted while another accepted admin (alfa) is left'
);
select throws_ok(format($$select * from app.set_operator_role(%L, 'operator')$$, pg_temp.op('alfa')),
  'EO001', null, 'the last accepted admin cannot be demoted: an invited admin does not count');
select throws_ok(format($$select * from app.set_operator_active(%L, false)$$, pg_temp.op('alfa')),
  'EO001', null, 'the last accepted admin cannot be deactivated');
select is(
  (select r.role from app.set_operator_role(pg_temp.op('Beta'), 'admin') r),
  'admin',
  'an admin account (on the phone) names another admin'
);
select is(
  (select r.status from app.set_operator_active(pg_temp.op('alfa'), false) r),
  'deactivated',
  'with another accepted admin, the first one can be deactivated'
);
select throws_ok(format($$select * from app.set_operator_active(%L, false)$$, pg_temp.op('Beta')),
  'EO001', null, 'a deactivated admin does not count either');
select throws_ok(format($$select * from app.set_operator_role(%L, 'operator')$$, pg_temp.op('Beta')),
  'EO001', null, 'nor for the role');
select is(
  (select r.role from app.set_operator_role(pg_temp.op('Beta'), 'admin') r),
  'admin',
  'the last admin keeps its role when asked for the same one (no removal, no EO001)'
);
reset role;
-- A removed admin (no account) does not count.
update app.operators set role = 'admin' where id = pg_temp.op('Aab Rimosso');
update app.operators set deactivated_at = null, deactivated_by = null where id = pg_temp.op('alfa');
select pg_temp.as_user('00000000-0000-4000-d500-000000000008');
set local role authenticated;
select is(
  (select r.status from app.set_operator_active(pg_temp.op('alfa'), false) r),
  'deactivated',
  'precondition: alfa deactivated again, Beta is the only accepted admin'
);
select throws_ok(format($$select * from app.set_operator_role(%L, 'operator')$$, pg_temp.op('Beta')),
  'EO001', null, 'a removed admin does not count');
reset role;
select is((select role || '|' || (deactivated_at is null) from app.operators where id = pg_temp.op('Beta')),
  'admin|true', 'EO001 wrote nothing');

-- Deactivated caller, deactivated cashier ------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-d500-000000000001');
set local role authenticated;
select throws_ok(format($$select * from app.set_operator_active(%L, true)$$, pg_temp.op('Gamma')),
  '42501', null, 'a deactivated admin can change nothing');
reset role;
select pg_temp.as_user('00000000-0000-4000-d500-000000000011');
set local role authenticated;
select throws_ok($$select * from app.list_operators()$$, '42501', null,
  'a device whose admin cashier was deactivated cannot list the operators');
reset role;

-- Privileges ------------------------------------------------------------------------------------
select is(
  array(select f::text from unnest(array[
      'app.list_operators()'::regprocedure,
      'app.set_operator_role(uuid, text)'::regprocedure,
      'app.set_operator_active(uuid, boolean)'::regprocedure]) f
    where not has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute')),
  array[]::text[],
  'the three RPCs are executable by authenticated, not by anon'
);
select is(
  array(select f::text from unnest(array[
      'private.operator_rows(uuid)'::regprocedure,
      'private.lock_operator_target(uuid)'::regprocedure,
      'private.assert_other_admin(app.operators)'::regprocedure]) f
    where has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute')),
  array[]::text[],
  'the private helpers are executable by neither authenticated nor anon'
);
select is(pg_temp.history(), current_setting('test.history'),
  'the movements are unchanged at the end');

select * from finish();
rollback;
