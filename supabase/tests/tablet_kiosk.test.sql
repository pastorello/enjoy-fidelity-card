-- tablet-kiosk: device accounts (app.devices), operator PINs (private.operator_pins),
-- current_device_id and the mutually exclusive add_device / add_operator
-- (SPEC-tablet-kiosk.md, "Modello dati e regole di accesso"). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'cassa.test@example.com'),
  ('00000000-0000-4000-8000-000000000002', 'cameriere.test@example.com'),
  ('00000000-0000-4000-8000-000000000003', 'sconosciuto.test@example.com'),
  ('00000000-0000-4000-8000-000000000004', 'cassa.nuova@example.com'),
  ('00000000-0000-4000-8000-000000000005', 'cassa.due@example.com');

select private.add_operator('cameriere.test@example.com', 'Cameriere Kiosk', 'operator');

-- Shape and privileges of the tables ------------------------------------------------
select is(
  array(
    select column_name::text from information_schema.columns
    where table_schema = 'app' and table_name = 'devices' order by ordinal_position
  ),
  array['id', 'user_id', 'name', 'cashier_operator_id', 'cashier_since', 'failed_pin_attempts',
        'locked_until', 'created_at'],
  'app.devices has the columns of the spec'
);
select is(
  array(
    select column_name::text from information_schema.columns
    where table_schema = 'private' and table_name = 'operator_pins' order by ordinal_position
  ),
  array['operator_id', 'pin_hash', 'updated_at'],
  'private.operator_pins keeps only the operator, the hash and the update time'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.devices'::regclass),
  'app.devices has row level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.operator_pins'::regclass),
  'private.operator_pins has row level security'
);
select is(
  (select count(*) from pg_policies
   where (schemaname, tablename) in (('app', 'devices'), ('private', 'operator_pins'))),
  0::bigint,
  'neither table has a policy'
);
select is(
  array(
    select r.role || ':' || t.tbl || ':' || p.priv
    from (values ('anon'), ('authenticated')) r (role)
    cross join (values ('app.devices'), ('private.operator_pins')) t (tbl)
    cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'),
                       ('trigger')) p (priv)
    where has_table_privilege(r.role, t.tbl, p.priv)
    union all
    select 'public:' || c.relname || ':' || acl.privilege_type
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where c.oid in ('app.devices'::regclass, 'private.operator_pins'::regclass) and acl.grantee = 0
  ),
  array[]::text[],
  'anon, authenticated and PUBLIC have no privilege on devices and operator_pins'
);
select throws_ok(
  $$insert into app.devices (name, failed_pin_attempts) values ('Contatore Strano', 5)$$,
  '23514',
  null,
  'failed_pin_attempts stays between 0 and 4'
);

-- add_device: create, relink, reject ------------------------------------------------
select isnt(
  private.add_device('CASSA.test@example.com', '  Tablet Kiosk  '),
  null,
  'add_device creates a device (email case-insensitive) and returns its id'
);
select is(
  (select name from app.devices where user_id = '00000000-0000-4000-8000-000000000001'),
  'Tablet Kiosk',
  'add_device trims the name'
);
select is(
  (select row(cashier_operator_id, cashier_since, failed_pin_attempts, locked_until)::text
   from app.devices where name = 'Tablet Kiosk'),
  row(null::uuid, null::timestamptz, 0, null::timestamptz)::text,
  'a new device has no cashier, no failed attempts and no lock'
);
select is(
  private.add_device('cassa.test@example.com', 'Tablet Kiosk'),
  (select id from app.devices where name = 'Tablet Kiosk'),
  'add_device is idempotent for the same account and name'
);
select throws_ok(
  $$select private.add_device('mancante@example.com', 'Tablet Nessuno')$$,
  'P0001',
  null,
  'add_device rejects an email without an Auth user'
);
select throws_ok(
  $$select private.add_device('cameriere.test@example.com', 'Tablet Cameriere')$$,
  'P0001',
  null,
  'add_device rejects a user linked to an operator'
);
select is(
  (select count(*) from app.devices where name = 'Tablet Cameriere'),
  0::bigint,
  'the rejected device is not created'
);
select throws_ok(
  $$select private.add_device('cassa.test@example.com', 'Altro Tablet')$$,
  'P0001',
  null,
  'add_device rejects an account already linked to another device'
);
select throws_ok(
  $$select private.add_device('cassa.due@example.com', 'tablet kiosk')$$,
  'P0001',
  null,
  'add_device rejects a name linked to another account (case-insensitive)'
);
select throws_ok(
  $$select private.add_device('cassa.due@example.com', '   ')$$,
  '23514',
  null,
  'a device name cannot be blank'
);

-- add_operator rejects a device user -----------------------------------------------
select throws_ok(
  $$select private.add_operator('cassa.test@example.com', 'Operatore Tablet', 'operator')$$,
  'P0001',
  null,
  'add_operator rejects a user linked to a device'
);
select is(
  (select count(*) from app.operators where name = 'Operatore Tablet'),
  0::bigint,
  'the rejected operator is not created'
);

-- Removing the Auth user keeps the device, unlinked, and add_device relinks it ------
delete from auth.users where id = '00000000-0000-4000-8000-000000000001';
select is(
  (select user_id from app.devices where name = 'Tablet Kiosk'),
  null,
  'deleting the Auth user leaves the device with user_id null'
);
select is(
  private.add_device('cassa.nuova@example.com', 'Tablet Kiosk'),
  (select id from app.devices where name = 'Tablet Kiosk'),
  'add_device relinks the existing device by name'
);
select is(
  (select user_id from app.devices where name = 'Tablet Kiosk'),
  '00000000-0000-4000-8000-000000000004'::uuid,
  'the relinked device belongs to the new account'
);

-- Only postgres executes the procedures ----------------------------------------------
select is(
  array(
    select r.role || ':' || f.fn
    from (values ('public'), ('anon'), ('authenticated'), ('service_role')) r (role)
    cross join (values ('private.add_device(text, text)'),
                       ('private.add_operator(text, text, text)')) f (fn)
    where r.role <> 'public' and has_function_privilege(r.role, f.fn, 'execute')
    union all
    select 'public:' || p.proname
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid in ('private.add_device(text, text)'::regprocedure,
                    'private.add_operator(text, text, text)'::regprocedure)
      and acl.grantee = 0
  ),
  array[]::text[],
  'no API role nor PUBLIC executes add_device or add_operator'
);
select ok(
  has_function_privilege('postgres', 'private.add_device(text, text)', 'execute'),
  'postgres executes add_device'
);

-- current_device_id -----------------------------------------------------------------
-- The expected id is read as postgres: the API role cannot read app.devices.
select set_config('test.kiosk_device_id', (select id::text from app.devices where name = 'Tablet Kiosk'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  private.current_device_id(),
  current_setting('test.kiosk_device_id')::uuid,
  'current_device_id returns the device linked to the caller'
);
select throws_ok(
  $$select count(*) from app.devices$$,
  '42501',
  null,
  'a device account cannot read app.devices directly'
);
select throws_ok(
  $$select count(*) from private.operator_pins$$,
  '42501',
  null,
  'a device account cannot read operator_pins'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(private.current_device_id(), null, 'current_device_id is null for an operator');
select throws_ok(
  $$update app.devices set cashier_operator_id = private.current_operator_id()$$,
  '42501',
  null,
  'an operator cannot write app.devices'
);
select throws_ok(
  $$insert into private.operator_pins (operator_id, pin_hash)
    values (private.current_operator_id(), 'x')$$,
  '42501',
  null,
  'an operator cannot write operator_pins'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(private.current_device_id(), null, 'current_device_id is null for a user without a link');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(private.current_device_id(), null, 'current_device_id is null for the token of a deleted user');
reset role;

set local role anon;
select throws_ok($$select count(*) from app.devices$$, '42501', null, 'anon cannot read app.devices');
select throws_ok(
  $$select count(*) from private.operator_pins$$, '42501', null, 'anon cannot read operator_pins'
);
reset role;

select * from finish();
rollback;
