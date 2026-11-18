-- tablet-kiosk: get_session_identity, list_cashiers and the seed devices and PINs
-- (SPEC-tablet-kiosk.md, "Modello dati e regole di accesso", success criteria 1, 3
-- and 5). The session tells the app whether it is an operator or a device, the
-- device's cashier while the turn is valid and how long a lock lasts; no RPC ever
-- returns a PIN hash. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-c000-000000000001', 'id.admin@example.com'),
  ('00000000-0000-4000-c000-000000000002', 'id.operator@example.com'),
  ('00000000-0000-4000-c000-000000000003', 'id.nopin@example.com'),
  ('00000000-0000-4000-c000-000000000004', 'id.device@example.com'),
  ('00000000-0000-4000-c000-000000000005', 'id.nobody@example.com'),
  ('00000000-0000-4000-c000-000000000006', 'id.gone@example.com');
select private.add_operator('id.admin@example.com', 'aa Admin Identità', 'admin');
select private.add_operator('id.operator@example.com', 'Ab Operatore Identità', 'operator');
select private.add_operator('id.nopin@example.com', 'ac Senza PIN Identità', 'operator');
select private.add_operator('id.gone@example.com', 'Ad Andato Identità', 'operator');
select private.add_device('id.device@example.com', 'Tablet Identità');

-- Fake PINs (bcrypt, as set_my_pin stores them). 'ac Senza PIN Identità' has none.
insert into private.operator_pins (operator_id, pin_hash)
select id, extensions.crypt('1234', extensions.gen_salt('bf', 8))
from app.operators
where name in ('aa Admin Identità', 'Ab Operatore Identità', 'Ad Andato Identità');

select set_config('test.admin_id', (select id::text from app.operators where name = 'aa Admin Identità'), true);
select set_config('test.operator_id', (select id::text from app.operators where name = 'Ab Operatore Identità'), true);
select set_config('test.nopin_id', (select id::text from app.operators where name = 'ac Senza PIN Identità'), true);
select set_config('test.gone_id', (select id::text from app.operators where name = 'Ad Andato Identità'), true);
select set_config('test.device_id', (select id::text from app.devices where name = 'Tablet Identità'), true);

-- Shape and privileges of the RPCs ------------------------------------------------------
select is(
  array(
    select p.oid::regprocedure::text || ':' || p.prosecdef::text || ':'
      || coalesce(array_to_string(p.proconfig, ','), '')
    from pg_proc p
    where p.oid in ('app.get_session_identity()'::regprocedure,
                    'app.list_cashiers()'::regprocedure)
    order by 1
  ),
  array['app.get_session_identity():true:search_path=""',
        'app.list_cashiers():true:search_path=""'],
  'the two RPCs are security definer with an empty search_path'
);
select is(
  array(
    select r.role || ':' || f.fn || ':' || has_function_privilege(r.role, f.fn, 'execute')::text
    from (values ('anon'), ('authenticated')) r (role)
    cross join (values ('app.get_session_identity()'), ('app.list_cashiers()')) f (fn)
    order by 1
  ),
  array['anon:app.get_session_identity():false', 'anon:app.list_cashiers():false',
        'authenticated:app.get_session_identity():true', 'authenticated:app.list_cashiers():true'],
  'authenticated executes the two RPCs, anon neither'
);

set local role anon;
select throws_ok($$select app.get_session_identity()$$, '42501', null, 'anon cannot run get_session_identity');
select throws_ok($$select * from app.list_cashiers()$$, '42501', null, 'anon cannot run list_cashiers');
reset role;

-- get_session_identity: operators and users without a profile -----------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000001","role":"authenticated"}', true);
select is(
  app.get_session_identity(),
  jsonb_build_object('kind', 'operator', 'operator', jsonb_build_object(
    'id', current_setting('test.admin_id'), 'name', 'aa Admin Identità', 'role', 'admin',
    'has_pin', true)),
  'an admin with a PIN: kind operator, has_pin true'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000003","role":"authenticated"}', true);
select is(
  app.get_session_identity(),
  jsonb_build_object('kind', 'operator', 'operator', jsonb_build_object(
    'id', current_setting('test.nopin_id'), 'name', 'ac Senza PIN Identità', 'role', 'operator',
    'has_pin', false)),
  'an operator without a PIN: has_pin false'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000005","role":"authenticated"}', true);
select is(app.get_session_identity(), null, 'a user without a profile: null');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-0000000000ff","role":"authenticated"}', true);
select is(app.get_session_identity(), null, 'the token of a user that does not exist: null');
reset role;

-- get_session_identity: a device ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(
  app.get_session_identity(),
  jsonb_build_object('kind', 'device',
    'device', jsonb_build_object('id', current_setting('test.device_id'), 'name', 'Tablet Identità'),
    'cashier', null, 'turn_expires_at', null, 'lock_seconds_left', 0),
  'a device without a cashier: cashier and turn_expires_at null, not locked'
);
select is(
  app.unlock_cashier(current_setting('test.operator_id')::uuid, '1234') ->> 'status',
  'ok',
  'the operator unlocks the till'
);
reset role;
select set_config('test.turn_expires_at',
  (select (cashier_since + interval '12 hours')::text from app.devices
   where id = current_setting('test.device_id')::uuid), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(
  app.get_session_identity(),
  jsonb_build_object('kind', 'device',
    'device', jsonb_build_object('id', current_setting('test.device_id'), 'name', 'Tablet Identità'),
    'cashier', jsonb_build_object(
      'id', current_setting('test.operator_id'), 'name', 'Ab Operatore Identità', 'role', 'operator'),
    'turn_expires_at', current_setting('test.turn_expires_at')::timestamptz,
    'lock_seconds_left', 0),
  'a device with a cashier: the cashier (id, name, role) and the end of the turn, 12 hours on'
);
reset role;

-- The turn is over after 12 hours: no cashier.
update app.devices set cashier_since = now() - interval '12 hours 1 second'
where id = current_setting('test.device_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(
  app.get_session_identity() -> 'cashier', 'null'::jsonb, 'a turn older than 12 hours: cashier null'
);
select is(
  app.get_session_identity() -> 'turn_expires_at', 'null'::jsonb,
  'a turn older than 12 hours: turn_expires_at null'
);
reset role;

-- Just inside the 12 hours the turn still holds.
update app.devices set cashier_since = now() - interval '11 hours 59 minutes'
where id = current_setting('test.device_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(
  app.get_session_identity() #>> '{cashier,id}', current_setting('test.operator_id'),
  'a turn younger than 12 hours keeps its cashier'
);
reset role;

-- A cashier whose Auth user is deleted is nobody.
update app.devices
set cashier_operator_id = current_setting('test.gone_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;
delete from auth.users where id = '00000000-0000-4000-c000-000000000006';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(
  app.get_session_identity() -> 'cashier', 'null'::jsonb, 'a cashier without an account: cashier null'
);
reset role;

-- A cashier whose PIN is gone is nobody either.
update app.devices
set cashier_operator_id = current_setting('test.nopin_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(
  app.get_session_identity() -> 'cashier', 'null'::jsonb, 'a cashier without a PIN: cashier null'
);
reset role;
update app.devices set cashier_operator_id = null, cashier_since = null
where id = current_setting('test.device_id')::uuid;

-- Locked (criterion 3): five wrong PINs, then the identity reports the seconds left,
-- read from the stored locked_until, so a reload (a new request) sees the lock too.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(app.unlock_cashier(current_setting('test.operator_id')::uuid, '9999') ->> 'status',
  'wrong_pin', 'first wrong PIN');
select is(app.unlock_cashier(current_setting('test.operator_id')::uuid, '9998') ->> 'status',
  'wrong_pin', 'second wrong PIN');
select is(app.unlock_cashier(current_setting('test.operator_id')::uuid, '9997') ->> 'status',
  'wrong_pin', 'third wrong PIN');
select is(app.unlock_cashier(current_setting('test.operator_id')::uuid, '9996') ->> 'status',
  'wrong_pin', 'fourth wrong PIN');
select is(app.unlock_cashier(current_setting('test.operator_id')::uuid, '9995') ->> 'status',
  'locked', 'the fifth wrong PIN locks the device');
select ok(
  (app.get_session_identity() ->> 'lock_seconds_left')::int between 1 and 300,
  'a locked device: lock_seconds_left between 1 and 300'
);
select is(
  app.get_session_identity() -> 'cashier', 'null'::jsonb, 'a locked device has no cashier'
);
reset role;

-- The lock lives in the row: set as another request would have committed it, part
-- of it passed. The seconds left follow locked_until and the clock, rounded up.
update app.devices
set locked_until = clock_timestamp() + interval '61.5 seconds', failed_pin_attempts = 0
where id = current_setting('test.device_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(
  (app.get_session_identity() ->> 'lock_seconds_left')::int, 62,
  'lock_seconds_left counts down from the stored locked_until, rounded up'
);
reset role;

update app.devices set locked_until = clock_timestamp() - interval '1 second'
where id = current_setting('test.device_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(
  (app.get_session_identity() ->> 'lock_seconds_left')::int, 0, 'a lock in the past: 0 seconds left'
);
reset role;
update app.devices set locked_until = null where id = current_setting('test.device_id')::uuid;

-- list_cashiers ---------------------------------------------------------------------------
-- What the list must be, read as postgres (a device without a cashier reads no operator).
select set_config('test.linked_names',
  array(select o.name from app.operators o where o.user_id is not null
        order by lower(o.name), o.id)::text, true);
-- Only linked operators, with has_pin, in alphabetical order regardless of case; the
-- seed's operators are there too, so the fake ones are picked out by name.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(
  array(
    select c.name || ':' || c.role || ':' || c.has_pin::text
    from app.list_cashiers() with ordinality c
    where c.name like '%Identità'
    order by c.ordinality
  ),
  array['aa Admin Identità:admin:true', 'Ab Operatore Identità:operator:true',
        'ac Senza PIN Identità:operator:false'],
  'a device without a cashier lists the linked operators, alphabetically, with has_pin'
);
select is(
  array(select c.name from app.list_cashiers() with ordinality c order by c.ordinality),
  current_setting('test.linked_names')::text[],
  'every linked operator, alphabetically, nobody unlinked'
);
select is(
  (select array_agg(c.id::text) from app.list_cashiers() c where c.name = 'aa Admin Identità'),
  array[current_setting('test.admin_id')],
  'each cashier comes with the operator id unlock_cashier takes'
);
select is(
  array(
    select a.name || ':' || format_type(a.type, null)
    from pg_proc p
    cross join lateral unnest(p.proargnames, p.proallargtypes) with ordinality a (name, type, n)
    where p.oid = 'app.list_cashiers()'::regprocedure
    order by a.n
  ),
  array['id:uuid', 'name:text', 'role:text', 'has_pin:boolean'],
  'list_cashiers returns id, name, role, has_pin and nothing else'
);
reset role;

-- With a cashier the list is the same (the tablet's settings show it for the switch).
update app.devices
set cashier_operator_id = current_setting('test.operator_id')::uuid, cashier_since = now()
where id = current_setting('test.device_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*) from app.list_cashiers() c where c.name like '%Identità'),
  3::bigint,
  'a device with a cashier lists them too'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000001","role":"authenticated"}', true);
select throws_ok($$select * from app.list_cashiers()$$, '42501', null, 'an admin account cannot list cashiers');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000002","role":"authenticated"}', true);
select throws_ok($$select * from app.list_cashiers()$$, '42501', null, 'an operator account cannot list cashiers');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000005","role":"authenticated"}', true);
select throws_ok($$select * from app.list_cashiers()$$, '42501', null, 'a user without a profile cannot list cashiers');
reset role;

-- No RPC returns a PIN hash -------------------------------------------------------------
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and ('pin_hash' = any (coalesce(p.proargnames, '{}'))
           or p.prorettype = 'private.operator_pins'::regtype
           or p.prorettype = 'app.devices'::regtype)
  ),
  array[]::text[],
  'no function in app has a pin_hash column or returns a PIN or device row'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000004","role":"authenticated"}', true);
select ok(
  app.get_session_identity()::text !~ '\$2[ab]\$'
    and (select coalesce(string_agg(c::text, ''), '') from app.list_cashiers() c) !~ '\$2[ab]\$',
  'neither the identity of a device nor the list of cashiers contains a bcrypt hash'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000001","role":"authenticated"}', true);
select ok(
  app.get_session_identity()::text !~ '\$2[ab]\$',
  'the identity of an operator contains no bcrypt hash'
);
reset role;

-- The seed (applied by db reset before the tests) ---------------------------------------
-- Only what no test changes: E2E open turns and lock cassa-blocco@, and set the PIN of
-- pin@example.com (Pin Prova, which the seed leaves without one).
select is(
  array(
    select d.name || ':' || u.email
    from app.devices d join auth.users u on u.id = d.user_id
    where u.email in ('cassa@example.com', 'cassa-blocco@example.com')
    order by u.email
  ),
  array['Tablet blocco:cassa-blocco@example.com', 'Tablet cassa:cassa@example.com'],
  'the seed links cassa@ to "Tablet cassa" and cassa-blocco@ to "Tablet blocco"'
);
select is(
  array(
    select o.name || ':' || (p.operator_id is not null)::text
    from app.operators o
    join auth.users u on u.id = o.user_id
    left join private.operator_pins p on p.operator_id = o.id
    where u.email in ('admin@example.com', 'operatore@example.com', 'recupero@example.com')
    order by o.name
  ),
  array['Admin Prova:true', 'Operatore Prova:true', 'Recupero Prova:true'],
  'the seed operators have fake PINs'
);
select ok(
  (select bool_and(p.pin_hash ~ '^\$2[ab]\$08\$.{53}$')
   from private.operator_pins p join app.operators o on o.id = p.operator_id
   where o.name in ('Admin Prova', 'Operatore Prova', 'Recupero Prova')),
  'the seed PINs are bcrypt hashes of cost 8, as set_my_pin stores them'
);
-- recupero@example.com is left out: e2e/password.spec.ts changes its password.
select is(
  (select count(*) from auth.users u
   where u.email in ('admin@example.com', 'operatore@example.com', 'pin@example.com',
                     'cassa@example.com', 'cassa-blocco@example.com')
     and u.email_confirmed_at is not null
     and u.encrypted_password = extensions.crypt('password-di-prova', u.encrypted_password)),
  5::bigint,
  'the seed accounts are confirmed and use the seed test password'
);
select is(
  (select count(*) from auth.identities i join auth.users u on u.id = i.user_id
   where u.email in ('pin@example.com', 'cassa@example.com', 'cassa-blocco@example.com')),
  3::bigint,
  'the new seed accounts have their email identity, so they can sign in'
);

select * from finish();
rollback;
