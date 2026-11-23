-- operators: administrators from the till tablet with the cashier's PIN asked again
-- (SPEC-operators.md points 5 and 7, Open Questions 11, decided 2026-11-23). From a device with
-- an admin cashier, inviting an admin, naming one and reactivating a deactivated one need the
-- cashier's PIN, checked in the same transaction as the action, with the counter and the
-- 5-errors/5-minutes lock of unlock_cashier. Without a PIN a device is refused (EO005); a phone
-- session never sends one. The PIN is never stored outside private.operator_pins. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

delete from private.operator_invites;

-- Fake Auth users. Accepted invite = email confirmed and a password.
insert into auth.users (id, email, email_confirmed_at, encrypted_password) values
  ('00000000-0000-4000-da00-000000000001', 'pin.admin.cassa@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-da00-000000000002', 'pin.admin.telefono@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-da00-000000000003', 'pin.operatore@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-da00-000000000004', 'pin.operatore.cassa@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-da00-000000000005', 'pin.admin.spento@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-da00-000000000011', 'pin.tablet@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4))),
  ('00000000-0000-4000-da00-000000000012', 'pin.tablet2@example.com', now(),
   extensions.crypt('password-di-prova', extensions.gen_salt('bf', 4)));
select private.add_operator('pin.admin.cassa@example.com', 'Alba PIN Ripetuto', 'admin');
select private.add_operator('pin.admin.telefono@example.com', 'Bice PIN Ripetuto', 'admin');
select private.add_operator('pin.operatore@example.com', 'Ciro PIN Ripetuto', 'operator');
select private.add_operator('pin.operatore.cassa@example.com', 'Dora PIN Ripetuto', 'operator');
select private.add_operator('pin.admin.spento@example.com', 'Ezio PIN Ripetuto', 'admin');
select private.add_device('pin.tablet@example.com', 'Tablet PIN Ripetuto');
select private.add_device('pin.tablet2@example.com', 'Tablet Due PIN Ripetuto');

create function pg_temp.op(p_name text)
returns uuid
language sql
as $$
  select id from app.operators where name = p_name || ' PIN Ripetuto';
$$;
grant execute on function pg_temp.op(text) to authenticated;

create function pg_temp.as_user(p_n int)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-da00-%s","role":"authenticated"}', lpad(p_n::text, 12, '0')),
    true);
$$;
grant execute on function pg_temp.as_user(int) to authenticated;

-- Operation ids: 00000000-0000-4000-db00-0000000000NN.
create function pg_temp.opid(p_n int)
returns uuid
language sql
as $$
  select format('00000000-0000-4000-db00-%s', lpad(p_n::text, 12, '0'))::uuid;
$$;
grant execute on function pg_temp.opid(int) to authenticated;

create function pg_temp.begin_admin(p_n int, p_pin text)
returns jsonb
language sql
as $$
  select app.operator_invite_begin(pg_temp.opid(p_n), format('Nuovo %s PIN Ripetuto', p_n),
    format('pin.nuovo%s@example.com', p_n), 'admin', p_pin);
$$;
grant execute on function pg_temp.begin_admin(int, text) to authenticated;

create function pg_temp.attempts(p_device text)
returns text
language sql
as $$
  select failed_pin_attempts || '|' || (locked_until is not null)
  from app.devices where name = p_device || ' PIN Ripetuto';
$$;

-- Fake PINs: Alba (admin cashier) 2468, Dora (operator cashier) 1357.
insert into private.operator_pins (operator_id, pin_hash) values
  (pg_temp.op('Alba'), extensions.crypt('2468', extensions.gen_salt('bf', 4))),
  (pg_temp.op('Dora'), extensions.crypt('1357', extensions.gen_salt('bf', 4)));
update app.operators set deactivated_at = now(), deactivated_by = pg_temp.op('Bice')
where id = pg_temp.op('Ezio');
update app.devices set cashier_operator_id = pg_temp.op('Alba'), cashier_since = now()
where name = 'Tablet PIN Ripetuto';
update app.devices set cashier_operator_id = pg_temp.op('Dora'), cashier_since = now()
where name = 'Tablet Due PIN Ripetuto';

-- Shape and privileges -----------------------------------------------------------------------
select has_function('app', 'set_operator_role_with_pin', array['uuid', 'text', 'text'],
  'app.set_operator_role_with_pin(uuid, text, text) exists');
select has_function('app', 'set_operator_active_with_pin', array['uuid', 'boolean', 'text'],
  'app.set_operator_active_with_pin(uuid, boolean, text) exists');
select has_function('app', 'operator_invite_begin', array['uuid', 'text', 'text', 'text', 'text'],
  'app.operator_invite_begin takes the PIN as its fifth argument');
select hasnt_function('app', 'operator_invite_begin', array['uuid', 'text', 'text', 'text'],
  'the four-argument operator_invite_begin is gone (one function, the PIN defaults to null)');
select is(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
   where p.oid in ('app.set_operator_role_with_pin(uuid, text, text)'::regprocedure,
                   'app.set_operator_active_with_pin(uuid, boolean, text)'::regprocedure,
                   'app.operator_invite_begin(uuid, text, text, text, text)'::regprocedure,
                   'private.check_cashier_pin(text, uuid)'::regprocedure)),
  true,
  'the PIN functions are security definer with an empty search_path'
);
select is(
  array(
    select r.role || ':' || f.fn || ':' || has_function_privilege(r.role, f.fn, 'execute')::text
    from (values ('anon'), ('authenticated')) r (role)
    cross join (values ('app.set_operator_role_with_pin(uuid, text, text)'),
                       ('app.set_operator_active_with_pin(uuid, boolean, text)'),
                       ('app.operator_invite_begin(uuid, text, text, text, text)'),
                       ('private.check_cashier_pin(text, uuid)')) f (fn)
    order by 1
  ),
  array['anon:app.operator_invite_begin(uuid, text, text, text, text):false',
        'anon:app.set_operator_active_with_pin(uuid, boolean, text):false',
        'anon:app.set_operator_role_with_pin(uuid, text, text):false',
        'anon:private.check_cashier_pin(text, uuid):false',
        'authenticated:app.operator_invite_begin(uuid, text, text, text, text):true',
        'authenticated:app.set_operator_active_with_pin(uuid, boolean, text):true',
        'authenticated:app.set_operator_role_with_pin(uuid, text, text):true',
        'authenticated:private.check_cashier_pin(text, uuid):false'],
  'authenticated runs the three RPCs but never the PIN check alone; anon nothing'
);
select hasnt_function('private', 'check_cashier_pin', array['text'],
  'the PIN check always names the operator whose rights were checked');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'private' and table_name = 'operator_invites' and column_name ilike '%pin%'),
  0,
  'the invite reservations have no column for a PIN'
);

-- A phone session never sends a PIN -----------------------------------------------------------
select pg_temp.as_user(2);
set local role authenticated;
select throws_ok(format($$select app.set_operator_role_with_pin(%L, 'admin', '2468')$$, pg_temp.op('Ciro')),
  '22023', null, 'a phone admin gets 22023 for a PIN: the PIN is asked only on a device');
select throws_ok(format($$select app.set_operator_active_with_pin(%L, true, '2468')$$, pg_temp.op('Ezio')),
  '22023', null, 'the same for a reactivation with a PIN from the phone');
select throws_ok($$select pg_temp.begin_admin(1, '2468')$$,
  '22023', null, 'the same for an invite with a PIN from the phone');
select is((select r.role from app.set_operator_role(pg_temp.op('Ciro'), 'admin') r), 'admin',
  'a phone admin still names an admin without any PIN');
select is((select r.role from app.set_operator_role(pg_temp.op('Ciro'), 'operator') r), 'operator',
  'and turns them back into an operator');
reset role;

-- A device with an operator cashier: no admin, and the PIN is never even counted ----------------
select pg_temp.as_user(12);
set local role authenticated;
select throws_ok(format($$select app.set_operator_role_with_pin(%L, 'admin', '1357')$$, pg_temp.op('Ciro')),
  '42501', null, 'a device with an operator cashier gets 42501, even with the right PIN');
select throws_ok(format($$select app.set_operator_role_with_pin(%L, 'admin', '0000')$$, pg_temp.op('Ciro')),
  '42501', null, 'and 42501 with a wrong one');
select throws_ok($$select pg_temp.begin_admin(2, '0000')$$,
  '42501', null, 'an invite from an operator cashier gets 42501');
reset role;
select is(pg_temp.attempts('Tablet Due'), '0|false',
  'a refused caller never touches the counter of wrong PINs');

-- A device with an admin cashier: the PIN is needed ------------------------------------------
select pg_temp.as_user(11);
set local role authenticated;
select throws_ok(format($$select * from app.set_operator_role(%L, 'admin')$$, pg_temp.op('Ciro')),
  'EO005', null, 'naming an admin without the PIN is still refused (EO005)');
select throws_ok(format($$select app.set_operator_role_with_pin(%L, 'admin', null)$$, pg_temp.op('Ciro')),
  'EO005', null, 'a null PIN is a missing PIN (EO005)');
select throws_ok(format($$select app.set_operator_role_with_pin(%L, 'admin', '12a4')$$, pg_temp.op('Ciro')),
  '22023', null, 'a PIN that is not 4 digits is 22023');
select throws_ok(format($$select app.set_operator_role_with_pin(%L, 'admin', '2468')$$, pg_temp.op('Alba')),
  'EO002', null, 'the cashier cannot name itself, PIN or not');
select throws_ok($$select pg_temp.begin_admin(3, null)$$,
  'EO005', null, 'inviting an admin without the PIN is still refused (EO005)');
reset role;
select is(pg_temp.attempts('Tablet'), '0|false', 'refusals before the check count no wrong PIN');
select is((select count(*)::int from private.operator_invites), 0, 'and reserve no invite');

select pg_temp.as_user(11);
set local role authenticated;
select is(app.set_operator_role_with_pin(pg_temp.op('Ciro'), 'admin', '9999'),
  '{"status": "wrong_pin", "attempts_left": 4}'::jsonb,
  'a wrong PIN answers wrong_pin with the attempts left, without raising');
reset role;
select is(pg_temp.attempts('Tablet'), '1|false', 'the wrong PIN is counted on the device');
select is((select role from app.operators where id = pg_temp.op('Ciro')), 'operator',
  'and the role did not change');

select pg_temp.as_user(11);
set local role authenticated;
select is(app.set_operator_role_with_pin(pg_temp.op('Ciro'), 'admin', '2468') ->> 'status', 'ok',
  'the right PIN names the admin');
select set_config('test.answer',
  (app.set_operator_role_with_pin(pg_temp.op('Ciro'), 'admin', '2468') -> 'operator')::text, true);
reset role;
-- Same caller (the claims stay), read as postgres: private.operator_rows is not for authenticated.
select is(
  current_setting('test.answer')::jsonb,
  (select to_jsonb(r) from private.operator_rows(pg_temp.op('Ciro')) r),
  'and answers with the profile as list_operators shows it'
);
select is((select role from app.operators where id = pg_temp.op('Ciro')), 'admin',
  'Ciro is an admin now');
select is(pg_temp.attempts('Tablet'), '0|false', 'a right PIN clears the counter, as unlock_cashier');

-- Demoting from a device needs no PIN, and a PIN given is checked anyway.
select pg_temp.as_user(11);
set local role authenticated;
select is((select r.role from app.set_operator_role(pg_temp.op('Ciro'), 'operator') r), 'operator',
  'turning an admin into an operator from a device needs no PIN');
select is(app.set_operator_role_with_pin(pg_temp.op('Ciro'), 'admin', '1111') ->> 'status', 'wrong_pin',
  'with_pin checks the PIN on every call');
reset role;

-- One counter and one lock with unlock_cashier -------------------------------------------------
select pg_temp.as_user(11);
set local role authenticated;
select is(app.set_operator_active_with_pin(pg_temp.op('Ezio'), true, '0000'),
  '{"status": "wrong_pin", "attempts_left": 3}'::jsonb,
  'a wrong PIN on a reactivation counts on the same counter');
select is(app.unlock_cashier(pg_temp.op('Alba'), '0000'),
  '{"status": "wrong_pin", "attempts_left": 2}'::jsonb,
  'unlock_cashier sees the wrong PINs of the admin actions');
select is(pg_temp.begin_admin(4, '0000'),
  '{"status": "wrong_pin", "attempts_left": 1}'::jsonb,
  'an invite with a wrong PIN answers wrong_pin');
reset role;
select is((select count(*)::int from private.operator_invites), 0,
  'an invite with a wrong PIN reserves nothing');
select pg_temp.as_user(11);
set local role authenticated;
select is(app.set_operator_role_with_pin(pg_temp.op('Ciro'), 'admin', '0000'),
  '{"status": "locked", "lock_seconds_left": 300}'::jsonb,
  'the fifth wrong PIN in a row locks the device for 5 minutes');
select is(app.set_operator_active_with_pin(pg_temp.op('Ezio'), true, '2468') ->> 'status', 'locked',
  'while locked even the right PIN is refused');
select ok((app.set_operator_active_with_pin(pg_temp.op('Ezio'), true, '2468') ->> 'lock_seconds_left')::int
  between 1 and 300, 'with the seconds the lock still lasts');
select is(pg_temp.begin_admin(5, '2468') ->> 'status', 'locked', 'an invite too');
select is(app.unlock_cashier(pg_temp.op('Alba'), '2468') ->> 'status', 'locked',
  'and the lock is the one of unlock_cashier');
reset role;
select is(pg_temp.attempts('Tablet'), '0|true', 'the device is locked, the counter starts again');
select is((select deactivated_at is not null from app.operators where id = pg_temp.op('Ezio')), true,
  'Ezio is still deactivated');
select is((select role from app.operators where id = pg_temp.op('Ciro')), 'operator',
  'Ciro is still an operator');
select is((select count(*)::int from private.operator_invites), 0, 'no invite was reserved');
select is(
  (select cashier_operator_id from app.devices where name = 'Tablet PIN Ripetuto'),
  pg_temp.op('Alba'),
  'the lock does not end the turn of the cashier'
);

-- The lock is over: reactivation and invite with the right PIN --------------------------------
update app.devices set locked_until = null where name = 'Tablet PIN Ripetuto';
select pg_temp.as_user(11);
set local role authenticated;
select throws_ok(format($$select * from app.set_operator_active(%L, true)$$, pg_temp.op('Ezio')),
  'EO005', null, 'reactivating a deactivated admin without the PIN is still refused');
select is(
  app.set_operator_active_with_pin(pg_temp.op('Ezio'), true, '2468') -> 'operator' ->> 'status',
  'active',
  'with the right PIN a deactivated admin is active again'
);
reset role;
select is(
  (select row(deactivated_at, deactivated_by)::text from app.operators where id = pg_temp.op('Ezio')),
  row(null::timestamptz, null::uuid)::text,
  'the reactivation cleared deactivated_at and deactivated_by'
);

select pg_temp.as_user(11);
set local role authenticated;
select is(pg_temp.begin_admin(6, '2468'),
  '{"status": "proceed", "invited_by_name": "Alba PIN Ripetuto"}'::jsonb,
  'with the right PIN an admin is invited from the device, in the name of the cashier');
select is(pg_temp.begin_admin(6, '2468'),
  '{"status": "in_progress"}'::jsonb,
  'the same operation again checks the PIN and answers as before');
select is(pg_temp.begin_admin(6, '0000') ->> 'status', 'wrong_pin',
  'a retry with a wrong PIN is refused before the reservation is read');
reset role;
select is(
  (select row(role, status, requested_by)::text from private.operator_invites
   where operation_id = pg_temp.opid(6)),
  row('admin', 'pending', pg_temp.op('Alba'))::text,
  'the reservation names the role admin and the cashier'
);
select is(
  (select count(*)::int from private.operator_invites i
   where to_jsonb(i)::text like '%2468%'),
  0,
  'the PIN is written nowhere in the reservation'
);

-- A deactivated operator comes back from the device without a PIN, as before.
update app.operators set deactivated_at = now(), deactivated_by = pg_temp.op('Bice')
where id = pg_temp.op('Ciro');
select pg_temp.as_user(11);
set local role authenticated;
select is((select r.status from app.set_operator_active(pg_temp.op('Ciro'), true) r), 'active',
  'a deactivated operator is reactivated from a device without a PIN');
select is(app.operator_invite_begin(pg_temp.opid(7), 'Nuovo 7 PIN Ripetuto',
    'pin.nuovo7@example.com', 'operator') ->> 'status', 'proceed',
  'an operator is invited from a device without a PIN');
reset role;

-- The PIN is the one of the operator whose rights were checked ---------------------------------
-- A race: the with_pin RPCs and operator_invite_begin check the rights with the cashier of that
-- moment, then wait on the device row while unlock_cashier hands the till to someone else. The
-- check then names the operator who passed the rights check, and refuses (42501, before any
-- PIN is compared or counted) when the cashier is no longer that operator, or no longer an admin.
-- Simulated here by changing the cashier between the two steps.
update app.devices
set failed_pin_attempts = 0, locked_until = null,
    cashier_operator_id = pg_temp.op('Dora'), cashier_since = now()
where name = 'Tablet PIN Ripetuto';
select pg_temp.as_user(11);
select throws_ok(format($$select private.check_cashier_pin('1357', %L)$$, pg_temp.op('Alba')),
  '42501', null, 'the cashier changed after the rights check: the right PIN of the new one is refused');
select throws_ok(format($$select private.check_cashier_pin('0000', %L)$$, pg_temp.op('Alba')),
  '42501', null, 'and so is a wrong PIN');
select throws_ok(format($$select private.check_cashier_pin('1357', %L)$$, pg_temp.op('Dora')),
  '42501', null, 'the PIN of a cashier who is no admin authorises nothing');
select is(pg_temp.attempts('Tablet'), '0|false', 'none of them compared or counted a PIN');
update app.devices set cashier_operator_id = pg_temp.op('Alba'), cashier_since = now()
where name = 'Tablet PIN Ripetuto';
select is(private.check_cashier_pin('2468', pg_temp.op('Alba')), null,
  'the same admin still at the till: the right PIN passes');

select * from finish();
rollback;
