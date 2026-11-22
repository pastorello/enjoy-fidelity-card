-- operators: the invite reservations (SPEC-operators.md point 5 and "Modello dati e regole di
-- accesso"). operator_invite_begin is called by the Edge Function with the caller's token and
-- answers in jsonb, so the reservation stays written; _finish, _fail and _orphan run only with
-- the secret key (service_role). Two invites to the same email or name never reach Auth
-- together; the same operation_id never sends two invites nor creates two profiles.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(148);

-- Reservations left on the local stack by the integration tests and the E2E (real invites): this
-- file counts the rows it makes, so it starts from none. Rolled back with everything else.
delete from private.operator_invites;

-- Fake Auth users. Accepted invite = email confirmed and a password.
insert into auth.users (id, email, email_confirmed_at, encrypted_password) values
  ('00000000-0000-4000-d700-000000000001', 'inv.anna@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d700-000000000002', 'inv.bruno@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d700-000000000003', 'inv.carla@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d700-000000000004', 'inv.off@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d700-000000000005', 'inv.removed@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d700-000000000006', 'inv.confirmed@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d700-000000000007', 'inv.unconfirmed@example.com', null, null),
  ('00000000-0000-4000-d700-000000000011', 'inv.device@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d700-000000000012', 'inv.device2@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d700-000000000013', 'inv.device3@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4)));
select private.add_operator('inv.anna@example.com', 'Anna Inviti', 'admin');
select private.add_operator('inv.bruno@example.com', 'Bruno Inviti', 'admin');
select private.add_operator('inv.carla@example.com', 'Carla Inviti', 'operator');
select private.add_operator('inv.off@example.com', 'Dario Inviti', 'operator');
select private.add_operator('inv.removed@example.com', 'Elena Inviti', 'operator');
select private.add_device('inv.device@example.com', 'Tablet Inviti');
select private.add_device('inv.device2@example.com', 'Tablet Due Inviti');
select private.add_device('inv.device3@example.com', 'Tablet Tre Inviti');

create function pg_temp.op(p_name text)
returns uuid
language sql
as $$
  select id from app.operators where name = p_name || ' Inviti';
$$;
grant execute on function pg_temp.op(text) to authenticated, service_role;

-- PINs for the cashiers; Dario deactivated; Elena removed (account deleted from the panel).
insert into private.operator_pins (operator_id, pin_hash)
select id, extensions.crypt('1234', extensions.gen_salt('bf', 4))
from app.operators where id in (pg_temp.op('Anna'), pg_temp.op('Carla'));
update app.operators set deactivated_at = now(), deactivated_by = pg_temp.op('Anna')
where id = pg_temp.op('Dario');
delete from auth.users where id = '00000000-0000-4000-d700-000000000005';
update app.devices set cashier_operator_id = pg_temp.op('Anna'), cashier_since = now()
where name = 'Tablet Inviti';
update app.devices set cashier_operator_id = pg_temp.op('Carla'), cashier_since = now()
where name = 'Tablet Due Inviti';

-- Callers and helpers.
create function pg_temp.as_user(p_sub text)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', p_sub), true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- Operation ids: 00000000-0000-4000-d800-0000000000NN.
create function pg_temp.opid(p_n int)
returns uuid
language sql
as $$
  select format('00000000-0000-4000-d800-%s', lpad(p_n::text, 12, '0'))::uuid;
$$;
grant execute on function pg_temp.opid(int) to authenticated, service_role;

create function pg_temp.begin_invite(p_n int, p_name text, p_email text, p_role text)
returns jsonb
language sql
as $$
  select app.operator_invite_begin(pg_temp.opid(p_n), p_name, p_email, p_role);
$$;
grant execute on function pg_temp.begin_invite(int, text, text, text) to authenticated;

create function pg_temp.invite_status(p_n int)
returns text
language sql
as $$
  select status from private.operator_invites where operation_id = pg_temp.opid(p_n);
$$;

-- What inviteUserByEmail would create: an unconfirmed user without a password.
create function pg_temp.new_user(p_n int, p_email text)
returns uuid
language sql
as $$
  insert into auth.users (id, email)
  values (format('00000000-0000-4000-d700-%s', lpad(p_n::text, 12, '0'))::uuid, p_email)
  returning id;
$$;

-- Shape ------------------------------------------------------------------------------------
select has_table('private', 'operator_invites', 'private.operator_invites exists');
select has_function('app', 'operator_invite_begin', array['uuid', 'text', 'text', 'text'],
  'app.operator_invite_begin(uuid, text, text, text) exists');
select has_function('app', 'operator_invite_finish', array['uuid', 'uuid'],
  'app.operator_invite_finish(uuid, uuid) exists');
select has_function('app', 'operator_invite_fail', array['uuid'],
  'app.operator_invite_fail(uuid) exists');
select has_function('app', 'operator_invite_orphan', array['uuid', 'uuid'],
  'app.operator_invite_orphan(uuid, uuid) exists');
select is(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
   where p.oid in ('app.operator_invite_begin(uuid, text, text, text)'::regprocedure,
                   'app.operator_invite_finish(uuid, uuid)'::regprocedure,
                   'app.operator_invite_fail(uuid)'::regprocedure,
                   'app.operator_invite_orphan(uuid, uuid)'::regprocedure)),
  true,
  'the invite functions are security definer with an empty search_path'
);

-- Privileges --------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated',
  'app.operator_invite_begin(uuid, text, text, text)', 'execute'),
  'authenticated can execute operator_invite_begin (is_admin is checked inside)');
select is(
  array(
    select f from unnest(array[
      'app.operator_invite_finish(uuid, uuid)',
      'app.operator_invite_fail(uuid)',
      'app.operator_invite_orphan(uuid, uuid)']) f
    where has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute')),
  array[]::text[],
  'anon and authenticated cannot execute _finish, _fail and _orphan'
);
select is(
  array(
    select f from unnest(array[
      'app.operator_invite_finish(uuid, uuid)',
      'app.operator_invite_fail(uuid)',
      'app.operator_invite_orphan(uuid, uuid)']) f
    where not has_function_privilege('service_role', f, 'execute')),
  array[]::text[],
  'service_role can execute _finish, _fail and _orphan'
);

select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select throws_ok($$select * from private.operator_invites$$, '42501', null,
  'an admin account cannot read private.operator_invites');
select throws_ok(
  $$select app.operator_invite_finish(pg_temp.opid(1), '00000000-0000-4000-d700-000000000006')$$,
  '42501', null, 'an admin account cannot execute operator_invite_finish');
select throws_ok($$select app.operator_invite_fail(pg_temp.opid(1))$$, '42501', null,
  'an admin account cannot execute operator_invite_fail');
select throws_ok(
  $$select app.operator_invite_orphan(pg_temp.opid(1), '00000000-0000-4000-d700-000000000007')$$,
  '42501', null, 'an admin account cannot execute operator_invite_orphan');
reset role;
set local role anon;
select throws_ok($$select * from private.operator_invites$$, '42501', null,
  'anon cannot read private.operator_invites');
select throws_ok(
  $$select app.operator_invite_begin(gen_random_uuid(), 'Nuovo Inviti', 'inv.new@example.com', 'operator')$$,
  '42501', null, 'anon cannot execute operator_invite_begin');
reset role;
set local role service_role;
select throws_ok($$select * from private.operator_invites$$, '42501', null,
  'not even service_role reads the reservations directly');
reset role;

-- begin: only admins ------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-d700-000000000003');
set local role authenticated;
select throws_ok($$select pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv.new@example.com', 'operator')$$,
  '42501', null, 'an operator account cannot invite');
reset role;
select pg_temp.as_user('00000000-0000-4000-d700-000000000004');
set local role authenticated;
select throws_ok($$select pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv.new@example.com', 'operator')$$,
  '42501', null, 'a deactivated account cannot invite');
reset role;
select pg_temp.as_user('00000000-0000-4000-d700-000000000013');
set local role authenticated;
select throws_ok($$select pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv.new@example.com', 'operator')$$,
  '42501', null, 'a device without a cashier cannot invite');
reset role;
select pg_temp.as_user('00000000-0000-4000-d700-000000000012');
set local role authenticated;
select throws_ok($$select pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv.new@example.com', 'operator')$$,
  '42501', null, 'a device with an operator cashier cannot invite');
reset role;
select is((select count(*)::int from private.operator_invites), 0,
  'a refused caller leaves no reservation');

-- begin: input ------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select throws_ok(
  $$select app.operator_invite_begin(null, 'Nuovo Inviti', 'inv.new@example.com', 'operator')$$,
  '22023', null, 'no operation_id -> 22023');
select throws_ok($$select pg_temp.begin_invite(1, '   ', 'inv.new@example.com', 'operator')$$,
  '22023', null, 'an empty name -> 22023');
select throws_ok($$select pg_temp.begin_invite(1, repeat('a', 61), 'inv.new@example.com', 'operator')$$,
  '22023', null, 'a name over 60 characters -> 22023');
select throws_ok($$select pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv.new.example.com', 'operator')$$,
  '22023', null, 'an email without @ -> 22023');
select throws_ok($$select pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv@example', 'operator')$$,
  '22023', null, 'an email without a dot after @ -> 22023');
select throws_ok(
  $$select pg_temp.begin_invite(1, 'Nuovo Inviti', repeat('a', 243) || '@example.com', 'operator')$$,
  '22023', null, 'an email over 254 characters -> 22023');
select throws_ok($$select pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv.new@example.com', 'boss')$$,
  '22023', null, 'a role other than admin or operator -> 22023');

-- begin: proceed, the same operation again, the same operation with other data --------------
select is(
  pg_temp.begin_invite(1, E'  Nuovo   Inviti ', '  Inv.New@Example.com ', 'operator'),
  '{"status": "proceed", "invited_by_name": "Anna Inviti"}'::jsonb,
  'a new email and name -> proceed with the name of who invites, no existing user');
reset role;
select is(
  (select concat_ws('|', name, email, role, status, existing_user, requested_by = pg_temp.op('Anna'))
   from private.operator_invites where operation_id = pg_temp.opid(1)),
  'Nuovo Inviti|inv.new@example.com|operator|pending|f|t',
  'the reservation keeps the cleaned name, the lower-case email and who asked'
);
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv.new@example.com', 'operator')->>'status',
  'in_progress', 'the same operation_id within 2 minutes -> in_progress');
select throws_ok($$select pg_temp.begin_invite(1, 'Nuovo Altro Inviti', 'inv.new@example.com', 'operator')$$,
  '22023', null, 'the same operation_id with another name -> 22023');
select throws_ok($$select pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv.other@example.com', 'operator')$$,
  '22023', null, 'the same operation_id with another email -> 22023');
select throws_ok($$select pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv.new@example.com', 'admin')$$,
  '22023', null, 'the same operation_id with another role -> 22023');

-- begin: another operation on the same email or name ---------------------------------------
select is(pg_temp.begin_invite(2, 'Nuovo Due Inviti', 'INV.NEW@example.com', 'operator')->>'status',
  'in_progress', 'another recent pending operation on the same email -> in_progress');
select is(pg_temp.begin_invite(3, 'nuovo inviti', 'inv.new3@example.com', 'operator')->>'status',
  'in_progress', 'another recent pending operation on the same name -> in_progress');
reset role;
select is(
  (select count(*)::int from private.operator_invites
   where operation_id in (pg_temp.opid(2), pg_temp.opid(3)) and status = 'pending'),
  0, 'an operation refused with in_progress holds no pending reservation');
update private.operator_invites set updated_at = now() - interval '3 minutes'
where operation_id = pg_temp.opid(1);
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(pg_temp.begin_invite(2, 'Nuovo Due Inviti', 'inv.new@example.com', 'operator')->>'status',
  'proceed', 'another pending operation older than 2 minutes on the same email -> proceed');
reset role;
select is(pg_temp.invite_status(1), 'failed', 'the stale operation becomes failed');
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(pg_temp.begin_invite(1, 'Nuovo Inviti', 'inv.new@example.com', 'operator')->>'status',
  'in_progress', 'the failed operation retried while another holds the email -> in_progress');
reset role;
update private.operator_invites set updated_at = now() - interval '3 minutes'
where operation_id = pg_temp.opid(2);
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(pg_temp.begin_invite(2, 'Nuovo Due Inviti', 'inv.new@example.com', 'operator')->>'status',
  'proceed', 'the same operation pending for more than 2 minutes -> proceed again');

-- begin: taken email, device email, taken name, existing Auth users -------------------------
select is(pg_temp.begin_invite(4, 'Quattro Inviti', 'inv.carla@example.com', 'operator'),
  '{"status": "email_taken", "deactivated": false}'::jsonb,
  'the email of an operator -> email_taken');
select is(pg_temp.begin_invite(5, 'Cinque Inviti', 'inv.off@example.com', 'operator'),
  '{"status": "email_taken", "deactivated": true}'::jsonb,
  'the email of a deactivated operator -> email_taken with deactivated');
select is(pg_temp.begin_invite(6, 'Sei Inviti', 'inv.device@example.com', 'operator'),
  '{"status": "email_is_device"}'::jsonb, 'the email of a device -> email_is_device');
select is(pg_temp.begin_invite(7, 'CARLA INVITI', 'inv.sette@example.com', 'operator'),
  '{"status": "name_taken"}'::jsonb, 'the name of a linked profile, any case -> name_taken');
select is(pg_temp.begin_invite(8, 'Dario Inviti', 'inv.otto@example.com', 'operator'),
  '{"status": "name_taken"}'::jsonb, 'the name of a deactivated profile -> name_taken');
reset role;
select is(
  (select count(*)::int from private.operator_invites
   where operation_id in (pg_temp.opid(4), pg_temp.opid(5), pg_temp.opid(6), pg_temp.opid(7),
                          pg_temp.opid(8)) and status <> 'failed'),
  0, 'a refused invite leaves its reservation failed, so a corrected one starts at once');
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(pg_temp.begin_invite(9, 'Nove Inviti', 'inv.sette@example.com', 'operator')->>'status',
  'proceed', 'after name_taken the same email with another name -> proceed');
select is(pg_temp.begin_invite(10, 'Elena Inviti', 'inv.elena@example.com', 'operator')->>'status',
  'proceed', 'the name of a removed profile -> proceed (relinked by _finish)');
select is(pg_temp.begin_invite(11, 'Undici Inviti', 'inv.confirmed@example.com', 'operator'),
  '{"status": "proceed", "invited_by_name": "Anna Inviti",
    "existing_user_id": "00000000-0000-4000-d700-000000000006",
    "existing_confirmed": true, "existing_has_password": true}'::jsonb,
  'a confirmed Auth user not linked -> proceed with existing_confirmed');
select is(pg_temp.begin_invite(12, 'Dodici Inviti', 'inv.unconfirmed@example.com', 'admin'),
  '{"status": "proceed", "invited_by_name": "Anna Inviti",
    "existing_user_id": "00000000-0000-4000-d700-000000000007",
    "existing_confirmed": false, "existing_has_password": false}'::jsonb,
  'an unconfirmed Auth user not linked -> proceed with existing_user_id');
reset role;
select is(
  (select existing_user from private.operator_invites where operation_id = pg_temp.opid(12)),
  true, 'the reservation records that the Auth user was already there');

-- begin: from a device ----------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-d700-000000000011');
set local role authenticated;
select throws_ok($$select pg_temp.begin_invite(13, 'Tredici Inviti', 'inv.tredici@example.com', 'admin')$$,
  'EO005', null, 'a device with an admin cashier cannot invite an admin');
select is(pg_temp.begin_invite(13, 'Tredici Inviti', 'inv.tredici@example.com', 'operator'),
  '{"status": "proceed", "invited_by_name": "Anna Inviti"}'::jsonb,
  'a device with an admin cashier invites an operator, in the name of the cashier');
reset role;
select is(
  (select requested_by from private.operator_invites where operation_id = pg_temp.opid(13)),
  pg_temp.op('Anna'), 'the reservation of a device names the cashier who asked');

-- finish ------------------------------------------------------------------------------------
select pg_temp.new_user(21, 'inv.new@example.com');
set local role service_role;
select is(
  (select app.operator_invite_finish(pg_temp.opid(2), '00000000-0000-4000-d700-000000000021')
     - 'operator'),
  '{"status": "done"}'::jsonb, 'finish -> done');
reset role;
select is(
  (select concat_ws('|', o.name, o.role, o.user_id, o.invited_by = pg_temp.op('Anna'),
     o.invited_at is not null, o.deactivated_at is null)
   from app.operators o where o.name = 'Nuovo Due Inviti'),
  'Nuovo Due Inviti|operator|00000000-0000-4000-d700-000000000021|t|t|t',
  'finish creates the profile linked to the user, with who invited and when'
);
select is(
  (select concat_ws('|', status, operator_id = pg_temp.op('Nuovo Due'))
   from private.operator_invites where operation_id = pg_temp.opid(2)),
  'done|t', 'the reservation is done and names the profile');
set local role service_role;
select is(
  app.operator_invite_finish(pg_temp.opid(2), '00000000-0000-4000-d700-000000000021'),
  jsonb_build_object('status', 'done', 'operator', jsonb_build_object(
    'id', pg_temp.op('Nuovo Due'), 'name', 'Nuovo Due Inviti', 'role', 'operator')),
  'finish twice -> done with the same profile');
reset role;
select is((select count(*)::int from app.operators where name = 'Nuovo Due Inviti'), 1,
  'finish twice creates one profile');
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(pg_temp.begin_invite(2, 'Nuovo Due Inviti', 'inv.new@example.com', 'operator'),
  jsonb_build_object('status', 'done', 'operator', jsonb_build_object(
    'id', pg_temp.op('Nuovo Due'), 'name', 'Nuovo Due Inviti', 'role', 'operator')),
  'begin on a done operation -> done with the same profile, no new invite');
reset role;

-- finish with another user: refused, whether done or pending.
select pg_temp.new_user(22, 'inv.elena@example.com');
-- The removed Elena kept the till PIN of her old account: the relink below must drop it.
insert into private.operator_pins (operator_id, pin_hash)
values (pg_temp.op('Elena'), extensions.crypt('4321', extensions.gen_salt('bf', 4)));
set local role service_role;
select throws_ok(
  $$select app.operator_invite_finish(pg_temp.opid(2), '00000000-0000-4000-d700-000000000022')$$,
  '22023', null, 'finish of a done operation with another user -> refused');
select throws_ok(
  $$select app.operator_invite_finish(pg_temp.opid(10), '00000000-0000-4000-d700-000000000006')$$,
  '22023', null, 'finish with a user whose email is not the reserved one -> refused');
select throws_ok(
  $$select app.operator_invite_finish(pg_temp.opid(99), '00000000-0000-4000-d700-000000000022')$$,
  'P0002', null, 'finish of an unknown operation -> P0002');
select throws_ok(
  $$select app.operator_invite_finish(pg_temp.opid(1), '00000000-0000-4000-d700-000000000021')$$,
  '55000', null, 'finish of a failed operation -> refused, nothing created');

-- finish on the name of a removed profile: relinked.
select is(
  app.operator_invite_finish(pg_temp.opid(10), '00000000-0000-4000-d700-000000000022')->>'status',
  'done', 'finish on the name of a removed profile -> done');
reset role;
select is(
  (select concat_ws('|', o.id = pg_temp.op('Elena'), o.user_id, o.deactivated_at is null,
     o.invited_by = pg_temp.op('Anna'))
   from app.operators o where o.name = 'Elena Inviti'),
  format('t|%s|t|t', '00000000-0000-4000-d700-000000000022'),
  'the removed profile is relinked to the new user, not duplicated');
select is((select has_pin from private.operator_rows(pg_temp.op('Elena'))), false,
  'the relinked profile does not inherit the PIN of the old account');
-- The id is read before: a device without a cashier reads no row of app.operators.
select set_config('test.elena', pg_temp.op('Elena')::text, true);
select pg_temp.as_user('00000000-0000-4000-d700-000000000013');
set local role authenticated;
select is(app.unlock_cashier(current_setting('test.elena')::uuid, '4321')->>'status', 'no_pin',
  'the old PIN does not open a till turn for the new account');
reset role;

-- finish: the name taken meanwhile, the email linked meanwhile, the requester no longer admin.
select pg_temp.new_user(23, 'inv.sette@example.com');
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-d700-000000000031', 'inv.altro@example.com', now());
select private.add_operator('inv.altro@example.com', 'Nove Inviti', 'operator');
set local role service_role;
select is(
  app.operator_invite_finish(pg_temp.opid(9), '00000000-0000-4000-d700-000000000023'),
  '{"status": "name_taken"}'::jsonb, 'finish with the name taken meanwhile -> name_taken');
reset role;
select is(pg_temp.invite_status(9), 'pending', 'a refused finish leaves the reservation to _fail');
select private.add_device('inv.unconfirmed@example.com', 'Tablet Quattro Inviti');
set local role service_role;
select is(
  app.operator_invite_finish(pg_temp.opid(12), '00000000-0000-4000-d700-000000000007'),
  '{"status": "email_is_device"}'::jsonb,
  'finish with the user linked to a device meanwhile -> email_is_device');
reset role;
select private.add_operator('inv.confirmed@example.com', 'Altro Nome Inviti', 'operator');
set local role service_role;
select is(
  app.operator_invite_finish(pg_temp.opid(11), '00000000-0000-4000-d700-000000000006'),
  '{"status": "email_taken", "deactivated": false}'::jsonb,
  'finish with the user linked to another profile meanwhile -> email_taken');
reset role;

select pg_temp.as_user('00000000-0000-4000-d700-000000000002');
set local role authenticated;
select is(pg_temp.begin_invite(14, 'Quattordici Inviti', 'inv.quattordici@example.com', 'admin')->>'status',
  'proceed', 'a second admin starts an invite');
reset role;
update app.operators set role = 'operator' where id = pg_temp.op('Bruno');
select pg_temp.new_user(24, 'inv.quattordici@example.com');
set local role service_role;
select is(
  app.operator_invite_finish(pg_temp.opid(14), '00000000-0000-4000-d700-000000000024'),
  '{"status": "forbidden"}'::jsonb, 'finish after the requester lost the admin role -> forbidden');
reset role;
select is((select count(*)::int from app.operators where name = 'Quattordici Inviti'), 0,
  'a forbidden finish creates no profile');
update app.operators set role = 'admin' where id = pg_temp.op('Bruno');
update app.operators set deactivated_at = now(), deactivated_by = pg_temp.op('Anna')
where id = pg_temp.op('Bruno');
set local role service_role;
select is(
  app.operator_invite_finish(pg_temp.opid(14), '00000000-0000-4000-d700-000000000024'),
  '{"status": "forbidden"}'::jsonb, 'finish after the requester was deactivated -> forbidden');

-- fail --------------------------------------------------------------------------------------
select is(app.operator_invite_fail(pg_temp.opid(2)), false, 'fail on a done operation -> false');
reset role;
select is(pg_temp.invite_status(2), 'done', 'fail does not change a done operation');
set local role service_role;
select is(app.operator_invite_fail(pg_temp.opid(9)), true, 'fail on a pending operation -> true');
reset role;
select is(pg_temp.invite_status(9), 'failed', 'fail turns a pending operation into failed');
set local role service_role;
select is(app.operator_invite_fail(pg_temp.opid(9)), false, 'fail on a failed operation -> false');
select is(app.operator_invite_fail(pg_temp.opid(99)), false, 'fail on an unknown operation -> false');

-- orphan ------------------------------------------------------------------------------------
select is(app.operator_invite_orphan(pg_temp.opid(9), '00000000-0000-4000-d700-000000000023'), true,
  'orphan: a new user, unconfirmed, not linked, of this operation -> true');
reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-d700-000000000023';
set local role service_role;
select is(app.operator_invite_orphan(pg_temp.opid(9), '00000000-0000-4000-d700-000000000023'), false,
  'orphan: a confirmed user -> false');
select is(app.operator_invite_orphan(pg_temp.opid(2), '00000000-0000-4000-d700-000000000021'), false,
  'orphan: the user linked by a done operation -> false');
select is(app.operator_invite_orphan(pg_temp.opid(12), '00000000-0000-4000-d700-000000000007'), false,
  'orphan: a user that existed before the operation -> false');
select is(app.operator_invite_orphan(pg_temp.opid(14), '00000000-0000-4000-d700-000000000021'), false,
  'orphan: a user whose email is not the reserved one -> false');
reset role;

-- A new user whose email another operation now holds: never deleted under it.
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(pg_temp.begin_invite(15, 'Quindici Inviti', 'inv.quindici@example.com', 'operator')->>'status',
  'proceed', 'an invite to a new email');
reset role;
select pg_temp.new_user(25, 'inv.quindici@example.com');
update private.operator_invites set status = 'failed' where operation_id = pg_temp.opid(15);
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(pg_temp.begin_invite(16, 'Sedici Inviti', 'inv.quindici@example.com', 'operator')->>'status',
  'proceed', 'another operation takes the same email');
reset role;
set local role service_role;
select is(app.operator_invite_orphan(pg_temp.opid(15), '00000000-0000-4000-d700-000000000025'), false,
  'orphan: another operation holds the email -> false');
reset role;

-- Resend and cancel (SPEC-operators.md point 5) ----------------------------------------------
-- Fixtures: Gino invited (never opened the link), Ivo invited with the email confirmed and no
-- password (token verified, password not saved), Lia invited (to cancel), Mara invited (to
-- deactivate), Nino removed, Fabio an admin.
insert into auth.users (id, email, email_confirmed_at, encrypted_password) values
  ('00000000-0000-4000-d700-000000000041', 'inv.gino@example.com', null, null),
  ('00000000-0000-4000-d700-000000000042', 'inv.ivo@example.com', now(), ''),
  ('00000000-0000-4000-d700-000000000043', 'inv.lia@example.com', null, null),
  ('00000000-0000-4000-d700-000000000044', 'inv.fabio@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-d700-000000000045', 'inv.mara@example.com', null, null),
  ('00000000-0000-4000-d700-000000000046', 'inv.nino@example.com', null, null);
select private.add_operator('inv.gino@example.com', 'Gino Inviti', 'operator');
select private.add_operator('inv.ivo@example.com', 'Ivo Inviti', 'admin');
select private.add_operator('inv.lia@example.com', 'Lia Inviti', 'operator');
select private.add_operator('inv.fabio@example.com', 'Fabio Inviti', 'admin');
select private.add_operator('inv.mara@example.com', 'Mara Inviti', 'operator');
select private.add_operator('inv.nino@example.com', 'Nino Inviti', 'operator');
-- Nino removed while invited: the account was deleted from the panel.
delete from auth.users where id = '00000000-0000-4000-d700-000000000046';
update app.operators set invited_by = pg_temp.op('Anna'), invited_at = now() - interval '1 day'
where id in (pg_temp.op('Gino'), pg_temp.op('Ivo'), pg_temp.op('Lia'), pg_temp.op('Mara'));

select has_function('app', 'operator_resend_begin', array['uuid'],
  'app.operator_resend_begin(uuid) exists');
select has_function('app', 'operator_resend_finish', array['uuid', 'uuid'],
  'app.operator_resend_finish(uuid, uuid) exists');
select has_function('app', 'operator_cancel_begin', array['uuid'],
  'app.operator_cancel_begin(uuid) exists');
select has_function('app', 'operator_cancel_check', array['uuid', 'uuid', 'uuid'],
  'app.operator_cancel_check(uuid, uuid, uuid) exists');
select is(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
   where p.oid in ('app.operator_resend_begin(uuid)'::regprocedure,
                   'app.operator_resend_finish(uuid, uuid)'::regprocedure,
                   'app.operator_cancel_begin(uuid)'::regprocedure,
                   'app.operator_cancel_check(uuid, uuid, uuid)'::regprocedure)),
  true,
  'the resend and cancel functions are security definer with an empty search_path'
);
select is(
  array(
    select f from unnest(array['app.operator_resend_begin(uuid)', 'app.operator_cancel_begin(uuid)']) f
    where not has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute')),
  array[]::text[],
  'resend_begin and cancel_begin: authenticated yes (is_admin inside), anon no'
);
select is(
  array(
    select f from unnest(array[
      'app.operator_resend_finish(uuid, uuid)', 'app.operator_cancel_check(uuid, uuid, uuid)']) f
    where has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute')
       or not has_function_privilege('service_role', f, 'execute')),
  array[]::text[],
  'resend_finish and cancel_check: service_role only'
);
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select throws_ok(
  format('select app.operator_resend_finish(%L, %L)', pg_temp.op('Gino'), pg_temp.op('Anna')),
  '42501', null, 'authenticated cannot call operator_resend_finish');
select throws_ok(
  format('select app.operator_cancel_check(%L, %L, %L)', pg_temp.op('Lia'),
         '00000000-0000-4000-d700-000000000043', pg_temp.op('Anna')),
  '42501', null, 'authenticated cannot call operator_cancel_check');

-- resend_begin, as Anna (admin account).
select is(
  app.operator_resend_begin(pg_temp.op('Gino')),
  jsonb_build_object(
    'user_id', '00000000-0000-4000-d700-000000000041', 'email', 'inv.gino@example.com',
    'name', 'Gino Inviti', 'role_label', 'operatore', 'invited_by_name', 'Anna Inviti',
    'email_confirmed', false, 'requested_by', pg_temp.op('Anna')),
  'resend_begin: an invited person who never opened the link');
select is(
  app.operator_resend_begin(pg_temp.op('Ivo')),
  jsonb_build_object(
    'user_id', '00000000-0000-4000-d700-000000000042', 'email', 'inv.ivo@example.com',
    'name', 'Ivo Inviti', 'role_label', 'amministratore', 'invited_by_name', 'Anna Inviti',
    'email_confirmed', true, 'requested_by', pg_temp.op('Anna')),
  'resend_begin: email confirmed and an empty password is still invited (email_confirmed true)');
select throws_ok(format('select app.operator_resend_begin(%L)', pg_temp.op('Carla')),
  'EO004', null, 'resend_begin: an active person -> EO004');
select throws_ok(format('select app.operator_resend_begin(%L)', pg_temp.op('Dario')),
  'EO004', null, 'resend_begin: a deactivated person -> EO004');
select throws_ok(format('select app.operator_resend_begin(%L)', pg_temp.op('Nino')),
  'EO004', null, 'resend_begin: a removed person -> EO004');
select throws_ok(format('select app.operator_resend_begin(%L)', pg_temp.op('Anna')),
  'EO002', null, 'resend_begin: oneself -> EO002');
select throws_ok($$select app.operator_resend_begin('00000000-0000-4000-d799-000000000001')$$,
  'P0002', null, 'resend_begin: an unknown profile -> P0002');
reset role;

-- A deactivated invited person is not invited any more.
update app.operators set deactivated_at = now(), deactivated_by = pg_temp.op('Anna')
where id = pg_temp.op('Mara');
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select throws_ok(format('select app.operator_resend_begin(%L)', pg_temp.op('Mara')),
  'EO004', null, 'resend_begin: a deactivated invited person -> EO004');
select throws_ok(format('select app.operator_cancel_begin(%L)', pg_temp.op('Mara')),
  'EO004', null, 'cancel_begin: a deactivated invited person -> EO004');
reset role;

-- Not an admin: an operator account, a device with an operator cashier.
select pg_temp.as_user('00000000-0000-4000-d700-000000000003');
set local role authenticated;
select throws_ok(format('select app.operator_resend_begin(%L)', pg_temp.op('Gino')),
  '42501', null, 'resend_begin: an operator -> 42501');
select throws_ok(format('select app.operator_cancel_begin(%L)', pg_temp.op('Lia')),
  '42501', null, 'cancel_begin: an operator -> 42501');
reset role;
select pg_temp.as_user('00000000-0000-4000-d700-000000000012');
set local role authenticated;
select throws_ok(format('select app.operator_resend_begin(%L)', pg_temp.op('Gino')),
  '42501', null, 'resend_begin: a device with an operator cashier -> 42501');
reset role;

-- A device with an admin cashier: the cashier is the requester.
select pg_temp.as_user('00000000-0000-4000-d700-000000000011');
set local role authenticated;
select is(app.operator_resend_begin(pg_temp.op('Gino'))->>'requested_by', pg_temp.op('Anna')::text,
  'resend_begin from a device: requested_by is the admin cashier');
select is(app.operator_cancel_begin(pg_temp.op('Lia'))->>'requested_by', pg_temp.op('Anna')::text,
  'cancel_begin from a device: requested_by is the admin cashier');
reset role;

-- resend_finish: the requester becomes the inviter.
set local role service_role;
select is(app.operator_resend_finish(pg_temp.op('Gino'), pg_temp.op('Fabio')),
  '{"status": "done"}'::jsonb, 'resend_finish by an active admin -> done');
reset role;
select is(
  (select invited_by = pg_temp.op('Fabio') and invited_at = now() from app.operators
   where id = pg_temp.op('Gino')),
  true, 'resend_finish sets invited_by to the requester and invited_at to now');
update app.operators set role = 'operator' where id = pg_temp.op('Fabio');
set local role service_role;
select is(app.operator_resend_finish(pg_temp.op('Ivo'), pg_temp.op('Fabio')),
  '{"status": "forbidden"}'::jsonb, 'resend_finish after the requester was demoted -> forbidden');
reset role;
select is(
  (select invited_by = pg_temp.op('Anna') from app.operators where id = pg_temp.op('Ivo')),
  true, 'a forbidden resend_finish writes nothing');
update app.operators set role = 'admin', deactivated_at = now(), deactivated_by = pg_temp.op('Anna')
where id = pg_temp.op('Fabio');
set local role service_role;
select is(app.operator_resend_finish(pg_temp.op('Ivo'), pg_temp.op('Fabio')),
  '{"status": "forbidden"}'::jsonb, 'resend_finish after the requester was deactivated -> forbidden');
select throws_ok(
  format('select app.operator_resend_finish(%L, %L)', '00000000-0000-4000-d799-000000000001',
         pg_temp.op('Anna')),
  'P0002', null, 'resend_finish: an unknown profile -> P0002');
reset role;
update app.operators set deactivated_at = null, deactivated_by = null where id = pg_temp.op('Fabio');

-- cancel_begin, as Anna.
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(
  app.operator_cancel_begin(pg_temp.op('Lia')),
  jsonb_build_object('user_id', '00000000-0000-4000-d700-000000000043',
                     'requested_by', pg_temp.op('Anna')),
  'cancel_begin: an invited person -> {user_id, requested_by}');
select is(app.operator_cancel_begin(pg_temp.op('Ivo'))->>'user_id',
  '00000000-0000-4000-d700-000000000042',
  'cancel_begin: email confirmed without a password is still invited');
select throws_ok(format('select app.operator_cancel_begin(%L)', pg_temp.op('Carla')),
  'EO004', null, 'cancel_begin: an active person -> EO004');
select throws_ok(format('select app.operator_cancel_begin(%L)', pg_temp.op('Dario')),
  'EO004', null, 'cancel_begin: a deactivated person -> EO004');
select throws_ok(format('select app.operator_cancel_begin(%L)', pg_temp.op('Nino')),
  'EO004', null, 'cancel_begin: a removed person -> EO004');
select throws_ok(format('select app.operator_cancel_begin(%L)', pg_temp.op('Anna')),
  'EO002', null, 'cancel_begin: oneself -> EO002');
select throws_ok($$select app.operator_cancel_begin('00000000-0000-4000-d799-000000000001')$$,
  'P0002', null, 'cancel_begin: an unknown profile -> P0002');
reset role;

-- cancel_check, with the secret key.
set local role service_role;
select is(
  app.operator_cancel_check(pg_temp.op('Lia'), '00000000-0000-4000-d700-000000000043', pg_temp.op('Anna')),
  true, 'cancel_check: still invited, still linked, requester still admin -> true');
select is(
  app.operator_cancel_check(pg_temp.op('Lia'), '00000000-0000-4000-d700-000000000041', pg_temp.op('Anna')),
  false, 'cancel_check: the profile is not linked to that user -> false');
select is(
  app.operator_cancel_check(pg_temp.op('Lia'), '00000000-0000-4000-d700-000000000043', pg_temp.op('Lia')),
  false, 'cancel_check: the target as requester -> false');
select is(
  app.operator_cancel_check('00000000-0000-4000-d799-000000000001',
    '00000000-0000-4000-d700-000000000043', pg_temp.op('Anna')),
  false, 'cancel_check: an unknown profile -> false');
reset role;
update app.operators set role = 'operator' where id = pg_temp.op('Fabio');
set local role service_role;
select is(
  app.operator_cancel_check(pg_temp.op('Lia'), '00000000-0000-4000-d700-000000000043', pg_temp.op('Fabio')),
  false, 'cancel_check: the requester is no longer an admin -> false');
reset role;
update app.operators set role = 'admin', deactivated_at = now(), deactivated_by = pg_temp.op('Anna')
where id = pg_temp.op('Fabio');
set local role service_role;
select is(
  app.operator_cancel_check(pg_temp.op('Lia'), '00000000-0000-4000-d700-000000000043', pg_temp.op('Fabio')),
  false, 'cancel_check: the requester was deactivated -> false');
reset role;
-- Meanwhile Lia opened the link: as GoTrue does (signupVerify), a temporary password first, then
-- the email confirmed. She has not chosen a password yet: still invited.
update auth.users
set encrypted_password = extensions.crypt('temporanea-di-auth', extensions.gen_salt('bf', 4))
where id = '00000000-0000-4000-d700-000000000043';
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-d700-000000000043';
set local role service_role;
select is(
  app.operator_cancel_check(pg_temp.op('Lia'), '00000000-0000-4000-d700-000000000043', pg_temp.op('Anna')),
  true, 'cancel_check: the token verified, no password saved -> still invited, true');
reset role;
-- Then she saved her password (updateUser): the invite is accepted.
update auth.users
set encrypted_password = extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))
where id = '00000000-0000-4000-d700-000000000043';
set local role service_role;
select is(
  app.operator_cancel_check(pg_temp.op('Lia'), '00000000-0000-4000-d700-000000000043', pg_temp.op('Anna')),
  false, 'cancel_check: the person accepted the invite meanwhile -> false');
reset role;
-- Meanwhile Mara was deactivated (still unconfirmed).
set local role service_role;
select is(
  app.operator_cancel_check(pg_temp.op('Mara'), '00000000-0000-4000-d700-000000000045', pg_temp.op('Anna')),
  false, 'cancel_check: the person was deactivated meanwhile -> false');
reset role;
select is((select count(*)::int from app.operators where name like '% Inviti' and id in
  (pg_temp.op('Gino'), pg_temp.op('Ivo'), pg_temp.op('Lia'), pg_temp.op('Mara'))), 4,
  'resend and cancel never delete a profile');

-- Invite accepted = a password the person saved (SPEC-operators point 2, Open Questions 12) -------
-- Pia: an Auth user made in the dashboard, confirmed with a password, never linked (point 5, step 2).
insert into auth.users (id, email, email_confirmed_at, encrypted_password) values
  ('00000000-0000-4000-d700-000000000051', 'inv.pia@example.com', now(),
   extensions.crypt('scelta-dalla-dashboard', extensions.gen_salt('bf', 4)));
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(
  pg_temp.begin_invite(51, 'Pia Inviti', 'inv.pia@example.com', 'admin') - 'existing_user_id' - 'invited_by_name',
  '{"status": "proceed", "existing_confirmed": true, "existing_has_password": true}'::jsonb,
  'begin: a confirmed user with a password -> proceed, existing_confirmed and existing_has_password');
reset role;
-- The function replaces the password with a random one and sends a recovery link; then finish.
update auth.users
set encrypted_password = extensions.crypt('casuale-della-funzione', extensions.gen_salt('bf', 4))
where id = '00000000-0000-4000-d700-000000000051';
set local role service_role;
select is(
  app.operator_invite_finish(pg_temp.opid(51), '00000000-0000-4000-d700-000000000051')->>'status',
  'done', 'finish links the confirmed user');
reset role;
select is((select status from private.operator_rows(pg_temp.op('Pia'))), 'invited',
  'confirmed with a password nobody knows: invited, not active');
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(app.operator_resend_begin(pg_temp.op('Pia'))->>'email_confirmed', 'true',
  'resend_begin accepts her, with email_confirmed (a recovery link)');
select is(app.operator_cancel_begin(pg_temp.op('Pia'))->>'user_id', '00000000-0000-4000-d700-000000000051',
  'cancel_begin accepts her');
reset role;
set local role service_role;
select is(
  app.operator_cancel_check(pg_temp.op('Pia'), '00000000-0000-4000-d700-000000000051', pg_temp.op('Anna')),
  true, 'cancel_check: still invited -> true');
reset role;

-- Quinto: a new invitee who opens the link and leaves before saving a password.
select pg_temp.new_user(52, 'inv.quinto@example.com');
select pg_temp.as_user('00000000-0000-4000-d700-000000000001');
set local role authenticated;
select is(pg_temp.begin_invite(52, 'Quinto Inviti', 'inv.quinto@example.com', 'operator')->>'status',
  'proceed', 'begin: Quinto -> proceed');
reset role;
set local role service_role;
select is(
  app.operator_invite_finish(pg_temp.opid(52), '00000000-0000-4000-d700-000000000052')->>'status',
  'done', 'finish creates Quinto');
reset role;
-- GoTrue verifies the token (signupVerify): a temporary password, then the email confirmed.
update auth.users
set encrypted_password = extensions.crypt('temporanea-di-auth', extensions.gen_salt('bf', 4))
where id = '00000000-0000-4000-d700-000000000052';
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-d700-000000000052';
select is((select status from private.operator_rows(pg_temp.op('Quinto'))), 'invited',
  'the token verified, the password not saved: invited');
-- He comes back with a new link and saves his password (updateUser).
update auth.users
set encrypted_password = extensions.crypt('scelta-da-quinto', extensions.gen_salt('bf', 4))
where id = '00000000-0000-4000-d700-000000000052';
select is((select status from private.operator_rows(pg_temp.op('Quinto'))), 'active',
  'the password saved: active');

-- EO001: Pia does not count as another admin. Only Anna and Pia are admins for this check.
update app.operators set role = 'operator'
where role = 'admin' and id not in (pg_temp.op('Anna'), pg_temp.op('Pia'));
select throws_ok(
  $$select private.assert_other_admin(o) from app.operators o where o.id = pg_temp.op('Anna')$$,
  'EO001', null, 'an invited admin with a password nobody knows does not count for EO001');

select * from finish();
rollback;
