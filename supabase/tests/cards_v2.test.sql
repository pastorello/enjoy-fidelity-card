-- customers-v2: reformatted cards (SPEC-customers-v2.md, "Modello dati", app.cards and
-- app.release_card). A released card keeps its row with the uid and the customer of
-- the time; the uid is free again for a new row; the release is written once, only on
-- an inactive card, and a released card never becomes active again. Fake data only:
-- invented uids, names and @example.com addresses.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-c700-000000000001', 'release.admin@example.com'),
  ('00000000-0000-4000-c700-000000000002', 'release.operator@example.com'),
  ('00000000-0000-4000-c700-000000000003', 'release.nobody@example.com'),
  ('00000000-0000-4000-c700-000000000004', 'release.device@example.com');
select private.add_operator('release.admin@example.com', 'Admin Riformatta', 'admin');
select private.add_operator('release.operator@example.com', 'Operatore Riformatta', 'operator');
select private.add_device('release.device@example.com', 'Tablet Riformatta');

-- Fake PINs, so both operators can be the cashier of the device.
insert into private.operator_pins (operator_id, pin_hash)
select id, extensions.crypt('1234', extensions.gen_salt('bf', 8))
from app.operators
where name in ('Admin Riformatta', 'Operatore Riformatta');

select set_config('release_test.admin', (select id::text from app.operators where name = 'Admin Riformatta'), true);
select set_config('release_test.operator',
  (select id::text from app.operators where name = 'Operatore Riformatta'), true);
select set_config('release_test.device', (select id::text from app.devices where name = 'Tablet Riformatta'), true);

-- Fake customers:
--   Marta:  an active card (…01) and a deactivated one (…00) with a leftover link row
--   Bruno:  a deactivated card (…10), released by the admin cashier of the device
--   Rita:   anonymized; her card (…20) was deactivated by the anonymization
--   Nadia:  no cards, gets the uids freed above
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
select fake.id, fake.name, now(), current_setting('release_test.admin')::uuid, gen_random_uuid()
from (values
  ('00000000-0000-4000-c710-000000000001'::uuid, 'Marta Riformatta'),
  ('00000000-0000-4000-c710-000000000002'::uuid, 'Bruno Riformatta'),
  ('00000000-0000-4000-c710-000000000003'::uuid, 'Rita Riformatta'),
  ('00000000-0000-4000-c710-000000000004'::uuid, 'Nadia Riformatta')
) as fake (id, name);

insert into app.cards (id, uid, customer_id, active, associated_by, deactivated_at)
select fake.id, fake.uid, fake.customer, fake.active, current_setting('release_test.admin')::uuid,
  case when not fake.active then now() end
from (values
  ('00000000-0000-4000-c720-000000000000'::uuid, '04C7C7C7C70000', '00000000-0000-4000-c710-000000000001'::uuid, false),
  ('00000000-0000-4000-c720-000000000001'::uuid, '04C7C7C7C70001', '00000000-0000-4000-c710-000000000001'::uuid, true),
  ('00000000-0000-4000-c720-000000000010'::uuid, '04C7C7C7C70010', '00000000-0000-4000-c710-000000000002'::uuid, false),
  ('00000000-0000-4000-c720-000000000020'::uuid, '04C7C7C7C70020', '00000000-0000-4000-c710-000000000003'::uuid, true)
) as fake (id, uid, customer, active);

-- A link row left on the deactivated card: release_card removes it anyway.
insert into private.card_links (card_id, token_hash)
values ('00000000-0000-4000-c720-000000000000', private.card_token_hash('AAAAAAAAAAAAAAAAAAAAAA'));

-- Marta has points: the release never touches them.
insert into app.movements
  (operation_id, customer_id, kind, amount_cents, points, cents_per_point, operator_id)
values (gen_random_uuid(), '00000000-0000-4000-c710-000000000001', 'purchase', 4200, 42, 100,
  current_setting('release_test.admin')::uuid);

-- Rita anonymized: the anonymization trigger deactivates her card.
update app.customers
set name = 'Cliente cancellato riformatta', anonymized_at = now()
where id = '00000000-0000-4000-c710-000000000003';

-- Returns the DETAIL of the error a statement raises, or null when it raises none.
create function pg_temp.error_detail(p_sql text)
returns text
language plpgsql
as $$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
grant execute on function pg_temp.error_detail(text) to authenticated;

-- The constraint_name of the error a statement raises, or null when it raises none.
create function pg_temp.error_constraint(p_sql text)
returns text
language plpgsql
as $$
declare
  v_constraint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_constraint = constraint_name;
  return v_constraint;
end;
$$;

create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_sub), true);
$$;

create function pg_temp.as_cashier(p_operator text) returns void language sql as $$
  update app.devices
  set cashier_operator_id = p_operator::uuid, cashier_since = now()
  where id = current_setting('release_test.device')::uuid;
  select pg_temp.as_user('00000000-0000-4000-c700-000000000004');
$$;

-- Columns, constraints and indexes -------------------------------------------------------
select is(
  (select array_agg(column_name::text || ':' || data_type || ':' || is_nullable order by column_name)
   from information_schema.columns
   where table_schema = 'app' and table_name = 'cards' and column_name like 'release%'),
  array['release_operation_id:uuid:YES', 'released_at:timestamp with time zone:YES',
        'released_by:uuid:YES'],
  'cards has released_at, released_by and release_operation_id, all nullable'
);
select fk_ok('app', 'cards', 'released_by', 'app', 'operators', 'id', 'released_by references an operator');
select ok(
  not exists (select 1 from pg_constraint where conrelid = 'app.cards'::regclass and conname = 'cards_uid_key'),
  'cards_uid_key is no longer a table constraint'
);
select is(
  (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'cards_uid_key'),
  'CREATE UNIQUE INDEX cards_uid_key ON app.cards USING btree (uid) WHERE (released_at IS NULL)',
  'cards_uid_key is a unique index on uid for the cards not released'
);
select is(
  (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'cards_released_by_idx'),
  'CREATE INDEX cards_released_by_idx ON app.cards USING btree (released_by)',
  'released_by has its index'
);
select ok(
  exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = 'app.cards'::regclass and i.indisunique and i.indpred is null
      and i.indnatts = 1 and a.attname = 'release_operation_id'
  ),
  'release_operation_id is unique'
);
select throws_ok(
  $$insert into app.cards (uid, customer_id, associated_by, released_at, released_by, release_operation_id)
    values ('04C7C7C7C70099', '00000000-0000-4000-c710-000000000004',
      current_setting('release_test.admin')::uuid, now(), current_setting('release_test.admin')::uuid,
      gen_random_uuid())$$,
  '23514', null, 'an active card cannot be released (check)'
);
select throws_ok(
  $$insert into app.cards (uid, customer_id, active, associated_by, deactivated_at, released_at)
    values ('04C7C7C7C70099', '00000000-0000-4000-c710-000000000004', false,
      current_setting('release_test.admin')::uuid, now(), now())$$,
  '23514', null, 'released_at, released_by and release_operation_id are set together (check)'
);

-- Privileges -------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'app.release_card(uuid, uuid)', 'execute'),
  'authenticated can execute release_card'
);
select ok(
  not has_function_privilege('anon', 'app.release_card(uuid, uuid)', 'execute'),
  'anon cannot execute release_card'
);
select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') || ':' || pg_get_function_result(p.oid)
   from pg_proc p where p.oid = 'app.release_card(uuid, uuid)'::regprocedure),
  'true:search_path="":app.cards',
  'release_card is security definer with an empty search_path and returns app.cards'
);

-- release_card: who may call it ----------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-c700-000000000003');
set local role authenticated;
select throws_ok(
  $$select app.release_card(gen_random_uuid(), '00000000-0000-4000-c720-000000000000')$$,
  'P0001', 'not_operator', 'release_card: a user without an operator is not_operator'
);
reset role;

select pg_temp.as_user('00000000-0000-4000-c700-000000000002');
set local role authenticated;
select throws_ok(
  $$select app.release_card(gen_random_uuid(), '00000000-0000-4000-c720-000000000000')$$,
  'P0001', 'forbidden', 'release_card: an operator is forbidden'
);
reset role;

select pg_temp.as_cashier(current_setting('release_test.operator'));
set local role authenticated;
select throws_ok(
  $$select app.release_card(gen_random_uuid(), '00000000-0000-4000-c720-000000000000')$$,
  'P0001', 'forbidden', 'release_card: the operator cashier of the device is forbidden'
);
reset role;

select is(
  (select released_at from app.cards where id = '00000000-0000-4000-c720-000000000000'),
  null,
  'a refused release leaves the card as it was'
);

-- release_card: the admin --------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-c700-000000000001');
set local role authenticated;
select throws_ok(
  $$select app.release_card(null, '00000000-0000-4000-c720-000000000000')$$,
  '22023', null, 'release_card without an operation_id is 22023'
);
select throws_ok(
  $$select app.release_card(gen_random_uuid(), gen_random_uuid())$$,
  'P0001', 'card_not_found', 'release_card of an unknown card is card_not_found'
);
select throws_ok(
  $$select app.release_card(gen_random_uuid(), '00000000-0000-4000-c720-000000000001')$$,
  'P0001', 'card_active', 'an active card cannot be released: card_active'
);
select is(
  (select row(r.id, r.uid, r.customer_id, r.active, r.released_at is not null, r.released_by,
     r.release_operation_id)::text
   from app.release_card('00000000-0000-4000-c730-000000000001', '00000000-0000-4000-c720-000000000000') r),
  row('00000000-0000-4000-c720-000000000000'::uuid, '04C7C7C7C70000',
    '00000000-0000-4000-c710-000000000001'::uuid, false, true,
    current_setting('release_test.admin')::uuid, '00000000-0000-4000-c730-000000000001'::uuid)::text,
  'release_card releases a deactivated card and records who did it with the operation_id'
);
reset role;

select set_config('release_test.released_at',
  (select released_at::text from app.cards where id = '00000000-0000-4000-c720-000000000000'), true);
select is(
  (select row(uid, customer_id, active)::text from app.cards where id = '00000000-0000-4000-c720-000000000000'),
  row('04C7C7C7C70000', '00000000-0000-4000-c710-000000000001'::uuid, false)::text,
  'the released row is kept with its uid and its customer'
);
select is(
  (select count(*) from private.card_links where card_id = '00000000-0000-4000-c720-000000000000'),
  0::bigint,
  'the release deletes any link of the card'
);
select is(
  (select row(private.customer_balance('00000000-0000-4000-c710-000000000001'),
     (select count(*) from app.movements where customer_id = '00000000-0000-4000-c710-000000000001'))::text),
  row(42, 1::bigint)::text,
  'the balance and the movements of the customer do not change'
);
select ok(
  (select active from app.cards where id = '00000000-0000-4000-c720-000000000001'),
  'the other card of the customer stays active'
);

set local role authenticated;
select is(
  (select row(r.released_at, r.release_operation_id)::text
   from app.release_card('00000000-0000-4000-c730-000000000001', '00000000-0000-4000-c720-000000000000') r),
  row(current_setting('release_test.released_at')::timestamptz,
    '00000000-0000-4000-c730-000000000001'::uuid)::text,
  'the same operation_id again returns the row unchanged'
);
select is(
  (select row(r.released_at, r.release_operation_id)::text
   from app.release_card('00000000-0000-4000-c730-000000000002', '00000000-0000-4000-c720-000000000000') r),
  row(current_setting('release_test.released_at')::timestamptz,
    '00000000-0000-4000-c730-000000000001'::uuid)::text,
  'a card already released is returned unchanged with any operation_id'
);
select throws_ok(
  $$select app.release_card('00000000-0000-4000-c730-000000000001', '00000000-0000-4000-c720-000000000010')$$,
  '22023', null, 'an operation_id already used for another card is 22023'
);
reset role;
select is(
  (select released_at from app.cards where id = '00000000-0000-4000-c720-000000000010'),
  null,
  'the reused operation_id leaves the other card as it was'
);

-- The admin cashier of the device may release.
select pg_temp.as_cashier(current_setting('release_test.admin'));
set local role authenticated;
select lives_ok(
  $$select app.release_card('00000000-0000-4000-c730-000000000010', '00000000-0000-4000-c720-000000000010')$$,
  'release_card: the admin cashier of the device releases a card'
);
reset role;
select is(
  (select released_by from app.cards where id = '00000000-0000-4000-c720-000000000010'),
  current_setting('release_test.admin')::uuid,
  'released_by is the cashier'
);

-- The card of an anonymized customer (criterion 10).
select pg_temp.as_user('00000000-0000-4000-c700-000000000001');
set local role authenticated;
select lives_ok(
  $$select app.release_card('00000000-0000-4000-c730-000000000020', '00000000-0000-4000-c720-000000000020')$$,
  'the card of an anonymized customer can be released'
);
reset role;
select is(
  (select row(customer_id, released_at is not null)::text
   from app.cards where id = '00000000-0000-4000-c720-000000000020'),
  row('00000000-0000-4000-c710-000000000003'::uuid, true)::text,
  'it stays with the anonymized customer, released'
);

-- A released uid is free again ------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-c700-000000000002');
set local role authenticated;
select is(
  (select count(*) from app.lookup_card('04C7C7C7C70000')),
  0::bigint,
  'lookup_card finds no card for a released uid'
);
select is(
  (select row(r.customer_id, r.active, r.replaced_card_id)::text
   from app.associate_card('00000000-0000-4000-c710-000000000004', '04C7C7C7C70000') r),
  row('00000000-0000-4000-c710-000000000004'::uuid, true, null::uuid)::text,
  'associate_card gives a released uid to another customer'
);
select is(
  (select row(l.customer_id, l.customer_name, l.active)::text from app.lookup_card('04C7C7C7C70000') l),
  row('00000000-0000-4000-c710-000000000004'::uuid, 'Nadia Riformatta', true)::text,
  'lookup_card finds the new card of the uid'
);
reset role;
select is(
  (select array_agg(row(customer_id, released_at is not null)::text order by released_at nulls last)
   from app.cards where uid = '04C7C7C7C70000'),
  array[row('00000000-0000-4000-c710-000000000001'::uuid, true)::text,
        row('00000000-0000-4000-c710-000000000004'::uuid, false)::text],
  'the uid has two rows: the released one of Marta and the new one of Nadia'
);
select ok(
  not exists (select 1 from private.card_links where card_id in
    (select id from app.cards where uid = '04C7C7C7C70000')),
  'the new card starts without a link'
);

set local role authenticated;
-- raise_card_taken with two rows of the same uid: the one not released is the owner.
select throws_ok(
  $$select app.associate_card('00000000-0000-4000-c710-000000000002', '04C7C7C7C70000')$$,
  'P0001', 'card_taken', 'a reassociated uid is taken by its new customer'
);
select is(
  pg_temp.error_detail(
    $$select app.associate_card('00000000-0000-4000-c710-000000000002', '04C7C7C7C70000')$$)::jsonb,
  jsonb_build_object('owner_id', '00000000-0000-4000-c710-000000000004', 'owner_name', 'Nadia Riformatta',
    'active', true),
  'card_taken names the new customer, not the released row'
);
select is(
  (select s.name from app.create_customer_with_card('00000000-0000-4000-c730-000000000030',
     'Olga Riformatta', null, true, null, '04C7C7C7C70010') s),
  'Olga Riformatta',
  'create_customer_with_card accepts a released uid'
);
select is(
  (select row(l.customer_name, l.active)::text from app.lookup_card('04C7C7C7C70010') l),
  row('Olga Riformatta', true)::text,
  'the released uid now belongs to the new customer'
);
reset role;

-- unique_violation on the partial index is still card_taken ------------------------------------
select is(
  pg_temp.error_constraint(
    $$insert into app.cards (uid, customer_id, associated_by)
      values ('04C7C7C7C70000', '00000000-0000-4000-c710-000000000002',
        current_setting('release_test.admin')::uuid)$$),
  'cards_uid_key',
  'a duplicate uid among the cards not released violates cards_uid_key'
);

-- The same race in one transaction cannot be staged (the failed insert rolls back whatever
-- took the uid first), so raise_card_taken itself is called with two rows of one uid; the
-- concurrent case runs in tests/integration.
select is(
  pg_temp.error_detail($$select private.raise_card_taken('04C7C7C7C70000')$$)::jsonb,
  jsonb_build_object('owner_id', '00000000-0000-4000-c710-000000000004', 'owner_name', 'Nadia Riformatta',
    'active', true),
  'raise_card_taken with a released and a new row of the uid names the new owner'
);

-- Trigger: a release is final -----------------------------------------------------------------
select throws_ok(
  $$update app.cards set released_at = null, released_by = null, release_operation_id = null
    where id = '00000000-0000-4000-c720-000000000000'$$,
  '55000', null, 'released_at never goes back to null'
);
select throws_ok(
  $$update app.cards set released_at = released_at - interval '1 day'
    where id = '00000000-0000-4000-c720-000000000000'$$,
  '55000', null, 'released_at is written once'
);
select throws_ok(
  $$update app.cards set released_by = current_setting('release_test.operator')::uuid
    where id = '00000000-0000-4000-c720-000000000000'$$,
  '55000', null, 'released_by is written once'
);
select throws_ok(
  $$update app.cards set release_operation_id = gen_random_uuid()
    where id = '00000000-0000-4000-c720-000000000000'$$,
  '55000', null, 'release_operation_id is written once'
);
select throws_ok(
  $$update app.cards set active = true, deactivated_at = null
    where id = '00000000-0000-4000-c720-000000000000'$$,
  '55000', null, 'a released card never becomes active again'
);
select throws_ok(
  $$update app.cards set active = true, deactivated_at = null
    where id = '00000000-0000-4000-c720-000000000020'$$,
  '55000', null, 'the released card of an anonymized customer never becomes active again'
);
select throws_ok(
  $$update app.cards set released_at = now(), released_by = current_setting('release_test.admin')::uuid,
      release_operation_id = gen_random_uuid()
    where id = '00000000-0000-4000-c720-000000000001'$$,
  '55000', null, 'an active card is never released'
);
select throws_ok(
  $$update app.cards set active = false, deactivated_at = now(), released_at = now(),
      released_by = current_setting('release_test.admin')::uuid, release_operation_id = gen_random_uuid()
    where id = '00000000-0000-4000-c720-000000000001'$$,
  '55000', null, 'a card is not deactivated and released in the same update'
);

-- No uid in the errors of release_card ----------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-c700-000000000001');
select is(
  nullif(pg_temp.error_detail(
    $$select app.release_card(gen_random_uuid(), '00000000-0000-4000-c720-000000000001')$$), ''),
  null,
  'card_active carries no detail'
);

select * from finish();
rollback;
