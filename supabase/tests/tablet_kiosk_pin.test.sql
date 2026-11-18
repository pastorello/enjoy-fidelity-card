-- tablet-kiosk: set_my_pin, unlock_cashier and end_cashier_turn
-- (SPEC-tablet-kiosk.md, "Modello dati e regole di accesso", success criteria 2, 3
-- and 4). PINs are checked on the server, stored only as bcrypt hashes, and 5
-- wrong PINs in a row lock the device for 5 minutes. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-b000-000000000001', 'pin.admin@example.com'),
  ('00000000-0000-4000-b000-000000000002', 'pin.operator@example.com'),
  ('00000000-0000-4000-b000-000000000003', 'pin.nopin@example.com'),
  ('00000000-0000-4000-b000-000000000004', 'pin.device@example.com'),
  ('00000000-0000-4000-b000-000000000005', 'pin.device2@example.com'),
  ('00000000-0000-4000-b000-000000000006', 'pin.nobody@example.com'),
  ('00000000-0000-4000-b000-000000000007', 'pin.gone@example.com');
select private.add_operator('pin.admin@example.com', 'Admin Pin', 'admin');
select private.add_operator('pin.operator@example.com', 'Operatore Pin', 'operator');
select private.add_operator('pin.nopin@example.com', 'Senza Pin', 'operator');
select private.add_operator('pin.gone@example.com', 'Andato Pin', 'operator');
select private.add_device('pin.device@example.com', 'Tablet Pin');
select private.add_device('pin.device2@example.com', 'Tablet Pin Due');

select set_config('test.admin_id', (select id::text from app.operators where name = 'Admin Pin'), true);
select set_config('test.operator_id', (select id::text from app.operators where name = 'Operatore Pin'), true);
select set_config('test.nopin_id', (select id::text from app.operators where name = 'Senza Pin'), true);
select set_config('test.gone_id', (select id::text from app.operators where name = 'Andato Pin'), true);
select set_config('test.device_id', (select id::text from app.devices where name = 'Tablet Pin'), true);
select set_config('test.device2_id', (select id::text from app.devices where name = 'Tablet Pin Due'), true);

-- Shape and privileges of the RPCs ------------------------------------------------------
select is(
  array(
    select p.oid::regprocedure::text || ':' || p.prosecdef::text || ':'
      || coalesce(array_to_string(p.proconfig, ','), '')
    from pg_proc p
    where p.oid in ('app.set_my_pin(text)'::regprocedure,
                    'app.unlock_cashier(uuid, text)'::regprocedure,
                    'app.end_cashier_turn()'::regprocedure)
    order by 1
  ),
  array['app.end_cashier_turn():true:search_path=""',
        'app.set_my_pin(text):true:search_path=""',
        'app.unlock_cashier(uuid,text):true:search_path=""'],
  'the three RPCs are security definer with an empty search_path'
);
select is(
  array(
    select r.role || ':' || f.fn || ':' || has_function_privilege(r.role, f.fn, 'execute')::text
    from (values ('anon'), ('authenticated')) r (role)
    cross join (values ('app.set_my_pin(text)'), ('app.unlock_cashier(uuid, text)'),
                       ('app.end_cashier_turn()')) f (fn)
    order by 1
  ),
  array['anon:app.end_cashier_turn():false', 'anon:app.set_my_pin(text):false',
        'anon:app.unlock_cashier(uuid, text):false',
        'authenticated:app.end_cashier_turn():true', 'authenticated:app.set_my_pin(text):true',
        'authenticated:app.unlock_cashier(uuid, text):true'],
  'authenticated executes the three RPCs, anon none'
);

set local role anon;
select throws_ok($$select app.set_my_pin('1234')$$, '42501', null, 'anon cannot run set_my_pin');
select throws_ok(
  $$select app.unlock_cashier(current_setting('test.operator_id')::uuid, '1234')$$,
  '42501', null, 'anon cannot run unlock_cashier'
);
select throws_ok($$select app.end_cashier_turn()$$, '42501', null, 'anon cannot run end_cashier_turn');
reset role;

-- set_my_pin (criterion 4) -----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$select app.set_my_pin('1234')$$, '42501', null, 'a device cannot set a PIN'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$select app.set_my_pin('1234')$$, '42501', null, 'a user without a profile cannot set a PIN'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000002","role":"authenticated"}', true);
select throws_ok(
  format('select app.set_my_pin(%L)', v.pin), '22023', null,
  'set_my_pin rejects ' || coalesce(quote_literal(v.pin), 'null')
)
from (values ('123'), ('12345'), ('abcd'), ('12 4'), (' 1234'), ('1234 '), ('١٢٣٤'), (''),
             (null)) v (pin);
reset role;
select is(
  (select count(*) from private.operator_pins),
  0::bigint,
  'no PIN was stored by the rejected calls'
);

-- Turns of the operator open on both tablets, and another person's turn on the second.
update app.devices
set cashier_operator_id = current_setting('test.operator_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;
update app.devices
set cashier_operator_id = current_setting('test.admin_id')::uuid, cashier_since = now()
where id = current_setting('test.device2_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000002","role":"authenticated"}', true);
select lives_ok($$select app.set_my_pin('2580')$$, 'an operator sets their own PIN');
reset role;

select ok(
  (select pin_hash ~ '^\$2[ab]\$08\$.{53}$' from private.operator_pins
   where operator_id = current_setting('test.operator_id')::uuid),
  'the stored value is a bcrypt hash of cost 8'
);
select ok(
  (select pin_hash <> '2580' and position('2580' in pin_hash) = 0
     and pin_hash = extensions.crypt('2580', pin_hash)
   from private.operator_pins where operator_id = current_setting('test.operator_id')::uuid),
  'the hash verifies the PIN and does not contain it'
);
select is(
  (select row(cashier_operator_id, cashier_since)::text from app.devices
   where id = current_setting('test.device_id')::uuid),
  row(null::uuid, null::timestamptz)::text,
  'a new PIN closes the open turn of that person'
);
select is(
  (select cashier_operator_id from app.devices where id = current_setting('test.device2_id')::uuid),
  current_setting('test.admin_id')::uuid,
  'a new PIN leaves the turns of other people open'
);

-- Second tablet now also on the operator: a new PIN closes it as well.
update app.devices
set cashier_operator_id = current_setting('test.operator_id')::uuid, cashier_since = now()
where id in (current_setting('test.device_id')::uuid, current_setting('test.device2_id')::uuid);
select set_config('test.old_hash',
  (select pin_hash from private.operator_pins where operator_id = current_setting('test.operator_id')::uuid),
  true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000002","role":"authenticated"}', true);
select lives_ok($$select app.set_my_pin('2580')$$, 'set_my_pin is idempotent (same PIN again)');
select throws_ok(
  $$select pin_hash from private.operator_pins$$, '42501', null,
  'the operator cannot read the stored hashes'
);
reset role;

select is(
  (select count(*) from private.operator_pins where operator_id = current_setting('test.operator_id')::uuid),
  1::bigint,
  'one PIN row per operator (upsert)'
);
select ok(
  (select pin_hash <> current_setting('test.old_hash') and pin_hash = extensions.crypt('2580', pin_hash)
   from private.operator_pins where operator_id = current_setting('test.operator_id')::uuid),
  'setting the PIN again stores a fresh hash of the same PIN'
);
select is(
  (select count(*) from app.devices
   where cashier_operator_id = current_setting('test.operator_id')::uuid),
  0::bigint,
  'a new PIN closes the turns of that person on every tablet'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000001","role":"authenticated"}', true);
select lives_ok($$select app.set_my_pin('1357')$$, 'an admin sets their own PIN');
reset role;
select is(
  (select count(*) from private.operator_pins),
  2::bigint,
  'an admin sets only their own PIN'
);

-- The operator whose account is later deleted has a PIN too.
insert into private.operator_pins (operator_id, pin_hash)
values (current_setting('test.gone_id')::uuid, extensions.crypt('9999', extensions.gen_salt('bf', 8)));
delete from auth.users where id = '00000000-0000-4000-b000-000000000007';

-- unlock_cashier: who may call it ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select app.unlock_cashier(current_setting('test.operator_id')::uuid, '2580')$$,
  '42501', null, 'an operator account cannot run unlock_cashier'
);
select throws_ok($$select app.end_cashier_turn()$$, '42501', null,
  'an operator account cannot run end_cashier_turn');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$select app.unlock_cashier(current_setting('test.operator_id')::uuid, '2580')$$,
  '42501', null, 'a user without a profile cannot run unlock_cashier'
);
select throws_ok($$select app.end_cashier_turn()$$, '42501', null,
  'a user without a profile cannot run end_cashier_turn');

-- unlock_cashier as the device ----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select throws_ok(
  format('select app.unlock_cashier(%L::uuid, %L)', current_setting('test.operator_id'), v.pin),
  '22023', null,
  'unlock_cashier rejects ' || coalesce(quote_literal(v.pin), 'null') || ' as input error'
)
from (values ('258'), ('25800'), ('25a0'), (null)) v (pin);
select is(
  app.unlock_cashier(current_setting('test.nopin_id')::uuid, '1234'),
  '{"status": "no_pin"}'::jsonb,
  'an operator without a PIN gives no_pin'
);
select is(
  app.unlock_cashier(current_setting('test.gone_id')::uuid, '9999'),
  '{"status": "no_pin"}'::jsonb,
  'an operator whose account was deleted gives no_pin, even with the right PIN'
);
select is(
  app.unlock_cashier('00000000-0000-4000-b0ff-000000000000', '1234'),
  '{"status": "no_pin"}'::jsonb,
  'an unknown operator gives no_pin'
);
select is(
  app.unlock_cashier(null, '1234'),
  '{"status": "no_pin"}'::jsonb,
  'a null operator gives no_pin'
);
reset role;
select is(
  (select row(failed_pin_attempts, locked_until, cashier_operator_id)::text from app.devices
   where id = current_setting('test.device_id')::uuid),
  row(0, null::timestamptz, null::uuid)::text,
  'input errors and no_pin do not count as attempts'
);

-- Criterion 3: 5 wrong PINs in a row, on any operator, lock the device for 5 minutes.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select is(
  app.unlock_cashier(current_setting('test.operator_id')::uuid, '0000'),
  '{"status": "wrong_pin", "attempts_left": 4}'::jsonb,
  'a wrong PIN returns wrong_pin with the attempts left (no exception)'
);
reset role;
select is(
  (select failed_pin_attempts from app.devices where id = current_setting('test.device_id')::uuid),
  1,
  'the wrong attempt is stored on the device'
);
select is(
  (select failed_pin_attempts from app.devices where id = current_setting('test.device2_id')::uuid),
  0,
  'the counter is per device'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select is(
  app.unlock_cashier(current_setting('test.admin_id')::uuid, '2580'),
  '{"status": "wrong_pin", "attempts_left": 3}'::jsonb,
  'the counter is shared by every operator on the device'
);
select is(
  app.unlock_cashier(current_setting('test.operator_id')::uuid, '1357'),
  '{"status": "wrong_pin", "attempts_left": 2}'::jsonb,
  'third wrong PIN: 2 attempts left'
);
select is(
  app.unlock_cashier(current_setting('test.operator_id')::uuid, '9999'),
  '{"status": "wrong_pin", "attempts_left": 1}'::jsonb,
  'fourth wrong PIN: 1 attempt left'
);
select is(
  app.unlock_cashier(current_setting('test.operator_id')::uuid, '1111'),
  '{"status": "locked", "lock_seconds_left": 300}'::jsonb,
  'the fifth wrong PIN locks the device for 5 minutes'
);
reset role;
-- unlock_cashier reads the clock after locking the row: between this test's
-- transaction start and now.
select ok(
  (select failed_pin_attempts = 0 and cashier_operator_id is null
     and locked_until between now() + interval '5 minutes' and clock_timestamp() + interval '5 minutes'
   from app.devices where id = current_setting('test.device_id')::uuid),
  'the lock (5 minutes) is stored and the counter starts again from 0'
);
select set_config('test.locked_until',
  (select locked_until::text from app.devices where id = current_setting('test.device_id')::uuid), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select is(
  app.unlock_cashier(current_setting('test.operator_id')::uuid, '2580'),
  '{"status": "locked", "lock_seconds_left": 300}'::jsonb,
  'while locked even the right PIN gives locked'
);
select is(
  app.unlock_cashier(current_setting('test.operator_id')::uuid, '0000'),
  '{"status": "locked", "lock_seconds_left": 300}'::jsonb,
  'while locked a wrong PIN gives locked'
);
select is(
  app.unlock_cashier(current_setting('test.nopin_id')::uuid, '1234'),
  '{"status": "locked", "lock_seconds_left": 300}'::jsonb,
  'while locked the operator is not even looked at'
);
reset role;
select is(
  (select row(failed_pin_attempts, locked_until, cashier_operator_id)::text from app.devices
   where id = current_setting('test.device_id')::uuid),
  row(0, current_setting('test.locked_until')::timestamptz, null::uuid)::text,
  'attempts during the lock are not counted and do not extend it'
);

-- Part of the lock has passed: the seconds left follow locked_until, rounded up.
update app.devices set locked_until = clock_timestamp() + interval '61.5 seconds'
where id = current_setting('test.device_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select is(
  app.unlock_cashier(current_setting('test.operator_id')::uuid, '2580'),
  '{"status": "locked", "lock_seconds_left": 62}'::jsonb,
  'lock_seconds_left counts down from locked_until, rounded up'
);
reset role;

-- The lock has passed (moved in the test): the right PIN unlocks.
update app.devices set locked_until = now() - interval '1 second'
where id = current_setting('test.device_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select set_config('test.unlocked',
  app.unlock_cashier(current_setting('test.operator_id')::uuid, '2580')::text, true);
reset role;
select is(
  current_setting('test.unlocked')::jsonb,
  jsonb_build_object(
    'status', 'ok',
    'cashier', jsonb_build_object(
      'id', current_setting('test.operator_id')::uuid, 'name', 'Operatore Pin', 'role', 'operator'),
    'turn_expires_at',
      (select cashier_since + interval '12 hours' from app.devices
       where id = current_setting('test.device_id')::uuid)),
  'after the lock the right PIN gives ok with the cashier and the end of the turn (12 hours)'
);
-- As postgres with the device's claims: the API role cannot execute the helper itself.
select is(
  private.acting_operator_id(),
  current_setting('test.operator_id')::uuid,
  'the device now acts as the cashier (criterion 2)'
);
select ok(
  (select cashier_operator_id = current_setting('test.operator_id')::uuid
     and cashier_since between now() and clock_timestamp()
     and failed_pin_attempts = 0 and locked_until is null
   from app.devices where id = current_setting('test.device_id')::uuid),
  'success stores the cashier and the unlock time and clears counter and lock'
);

-- Success resets the counter: 4 wrong, right, then 4 wrong again do not lock.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select app.unlock_cashier(current_setting('test.admin_id')::uuid, '0000') from generate_series(1, 3);
select is(
  app.unlock_cashier(current_setting('test.admin_id')::uuid, '0000'),
  '{"status": "wrong_pin", "attempts_left": 1}'::jsonb,
  'four wrong PINs leave one attempt'
);
reset role;
select is(
  (select cashier_operator_id from app.devices where id = current_setting('test.device_id')::uuid),
  current_setting('test.operator_id')::uuid,
  'a wrong PIN leaves the current cashier in place'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select is(
  app.unlock_cashier(current_setting('test.admin_id')::uuid, '1357') ->> 'status',
  'ok',
  'the right PIN on the fifth attempt unlocks'
);
select is(
  private.is_admin(),
  true,
  'the device now acts as the admin cashier'
);
select is(
  app.unlock_cashier(current_setting('test.admin_id')::uuid, '0000'),
  '{"status": "wrong_pin", "attempts_left": 4}'::jsonb,
  'success reset the counter: the next wrong PIN leaves 4 attempts'
);
reset role;

-- end_cashier_turn (criterion 2) ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select lives_ok($$select app.end_cashier_turn()$$, 'a device ends the turn');
select lives_ok($$select app.end_cashier_turn()$$, 'end_cashier_turn again does not fail');
reset role;
select is(private.acting_operator_id(), null, 'after end_cashier_turn the device acts as nobody');
select is(
  (select row(cashier_operator_id, cashier_since, failed_pin_attempts)::text
   from app.devices where id = current_setting('test.device_id')::uuid),
  row(null::uuid, null::timestamptz, 1)::text,
  'end_cashier_turn clears the cashier and keeps the counter of wrong PINs'
);
select is(
  (select cashier_operator_id from app.devices where id = current_setting('test.device2_id')::uuid),
  null,
  'precondition: the second tablet has no cashier'
);
update app.devices
set cashier_operator_id = current_setting('test.admin_id')::uuid, cashier_since = now()
where id = current_setting('test.device2_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select app.end_cashier_turn();
reset role;
select is(
  (select cashier_operator_id from app.devices where id = current_setting('test.device2_id')::uuid),
  current_setting('test.admin_id')::uuid,
  'end_cashier_turn touches only the caller''s device'
);

-- A lock cannot be lifted by ending the turn.
update app.devices set failed_pin_attempts = 0, locked_until = now() + interval '5 minutes'
where id = current_setting('test.device_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-b000-000000000004","role":"authenticated"}', true);
select app.end_cashier_turn();
reset role;
select is(
  (select locked_until from app.devices where id = current_setting('test.device_id')::uuid),
  now() + interval '5 minutes',
  'end_cashier_turn does not lift a lock'
);

-- No RPC hands out the hash.
select is(
  array(
    select p.proname::text from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and (pg_get_function_result(p.oid) ilike '%pin_hash%')
  ),
  array[]::text[],
  'no app function returns a pin_hash column'
);

select * from finish();
rollback;
