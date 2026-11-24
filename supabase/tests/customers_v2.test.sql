-- customers-v2: the last activity of a customer (SPEC-customers-v2.md, "Ultima attività
-- denormalizzata"): last_activity_at written only by the movements trigger, its generated
-- columns, the backfill and the home list index; the email column and app.list_customers
-- (point 6). Fake data only: invented names, @example.com emails.
begin;
create extension if not exists pgtap with schema extensions;
select plan(111);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a800-000000000001', 'activity.admin@example.com'),
  ('00000000-0000-4000-a800-000000000002', 'activity.operator@example.com');
select private.add_operator('activity.admin@example.com', 'Admin Attività', 'admin');
select private.add_operator('activity.operator@example.com', 'Operatore Attività', 'operator');

-- A fixed instant for the whole file, so every expected value is exact.
select set_config('activity_test.t0', '2026-11-20 10:15:00.123456+01', true);

-- Fake customers:
--   Ada:   purchase, redemption, an older purchase, a correction → the redemption
--   Bruno: purchase, then its correction (cancelled purchase)    → the purchase
--   Carla: no movements                                          → null
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id, created_at)
select fake.id, fake.name, now(), (select id from app.operators where name = 'Admin Attività'),
  gen_random_uuid(), current_setting('activity_test.t0')::timestamptz - interval '30 days'
from (values
  ('00000000-0000-4000-a810-000000000001'::uuid, 'Ada Attività'),
  ('00000000-0000-4000-a810-000000000002'::uuid, 'Bruno Attività'),
  ('00000000-0000-4000-a810-000000000003'::uuid, 'Carla Attività')
) as fake (id, name);

-- Inserts one movement as the ledger RPCs would, at t0 + p_offset.
create function pg_temp.add_movement(
  p_id text, p_customer text, p_kind text, p_offset interval, p_corrects text default null
) returns void language sql as $$
  insert into app.movements
    (id, operation_id, customer_id, kind, amount_cents, points, cents_per_point, description,
     operator_id, created_at, corrects_movement_id)
  select p_id::uuid, gen_random_uuid(), p_customer::uuid, p_kind,
    case p_kind when 'purchase' then 1000 end,
    case p_kind when 'purchase' then 10 when 'redemption' then -5
      else -(select points from app.movements where id = p_corrects::uuid) end,
    case p_kind when 'purchase' then 100 end,
    case p_kind when 'redemption' then 'Caffè di prova' end,
    (select id from app.operators where name = 'Operatore Attività'),
    current_setting('activity_test.t0')::timestamptz + p_offset, p_corrects::uuid;
$$;

create function pg_temp.activity(p_customer text) returns timestamptz language sql as $$
  select last_activity_at from app.customers where id = p_customer::uuid;
$$;

-- Columns --------------------------------------------------------------------------------
select col_type_is('app', 'customers', 'last_activity_at', 'timestamp with time zone',
  'last_activity_at is a timestamptz');
select col_is_null('app', 'customers', 'last_activity_at', 'last_activity_at is nullable');
select is(
  (select array_agg(column_name::text || ':' || is_generated || ':' || data_type order by column_name)
   from information_schema.columns
   where table_schema = 'app' and table_name = 'customers'
     and column_name in ('has_activity', 'sort_at')),
  array['has_activity:ALWAYS:boolean', 'sort_at:ALWAYS:timestamp with time zone'],
  'has_activity and sort_at are generated columns'
);

-- A customer without movements -----------------------------------------------------------
select is(pg_temp.activity('00000000-0000-4000-a810-000000000003'), null,
  'a customer without movements has no last activity');
select is(
  (select (has_activity, sort_at = created_at)::text from app.customers
   where id = '00000000-0000-4000-a810-000000000003'),
  '(f,t)',
  'without activity: has_activity false and sort_at = created_at'
);

-- The trigger ----------------------------------------------------------------------------
select pg_temp.add_movement('00000000-0000-4000-a820-000000000001',
  '00000000-0000-4000-a810-000000000001', 'purchase', interval '0');
select is(pg_temp.activity('00000000-0000-4000-a810-000000000001'),
  current_setting('activity_test.t0')::timestamptz,
  'a purchase sets last_activity_at to its created_at, microseconds included');
select is(
  (select (has_activity, sort_at = last_activity_at)::text from app.customers
   where id = '00000000-0000-4000-a810-000000000001'),
  '(t,t)',
  'with activity: has_activity true and sort_at = last_activity_at'
);

select pg_temp.add_movement('00000000-0000-4000-a820-000000000002',
  '00000000-0000-4000-a810-000000000001', 'redemption', interval '1 minute');
select is(pg_temp.activity('00000000-0000-4000-a810-000000000001'),
  current_setting('activity_test.t0')::timestamptz + interval '1 minute',
  'a redemption moves last_activity_at forward');

select pg_temp.add_movement('00000000-0000-4000-a820-000000000003',
  '00000000-0000-4000-a810-000000000001', 'purchase', interval '-1 hour');
select is(pg_temp.activity('00000000-0000-4000-a810-000000000001'),
  current_setting('activity_test.t0')::timestamptz + interval '1 minute',
  'an older movement never moves last_activity_at back');

select pg_temp.add_movement('00000000-0000-4000-a820-000000000004',
  '00000000-0000-4000-a810-000000000001', 'correction', interval '2 minutes',
  '00000000-0000-4000-a820-000000000002');
select is(pg_temp.activity('00000000-0000-4000-a810-000000000001'),
  current_setting('activity_test.t0')::timestamptz + interval '1 minute',
  'a correction does not count as activity');

select pg_temp.add_movement('00000000-0000-4000-a820-000000000005',
  '00000000-0000-4000-a810-000000000002', 'purchase', interval '5 minutes');
select pg_temp.add_movement('00000000-0000-4000-a820-000000000006',
  '00000000-0000-4000-a810-000000000002', 'correction', interval '6 minutes',
  '00000000-0000-4000-a820-000000000005');
select is(pg_temp.activity('00000000-0000-4000-a810-000000000002'),
  current_setting('activity_test.t0')::timestamptz + interval '5 minutes',
  'a cancelled purchase still counts: the customer came to the bar (Open Question 1)');
select is(pg_temp.activity('00000000-0000-4000-a810-000000000003'), null,
  'movements of other customers leave a customer without activity untouched');

-- Through the ledger RPC, as an operator: the trigger runs inside record_purchase.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a800-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-a810-000000000003', 1250)$$,
  'an operator records a purchase through the ledger RPC'
);
reset role;
select is(
  (select last_activity_at = (select max(created_at) from app.movements
                              where customer_id = '00000000-0000-4000-a810-000000000003')
   from app.customers where id = '00000000-0000-4000-a810-000000000003'),
  true,
  'a purchase recorded through the ledger RPC sets last_activity_at'
);

-- The backfill ---------------------------------------------------------------------------
-- The migration filled last_activity_at with private.backfill_customer_activity() before
-- the seed existed; here it runs again on rows whose value was wiped.
update app.customers set last_activity_at = null;
select lives_ok($$select private.backfill_customer_activity()$$, 'the backfill runs');
select is(pg_temp.activity('00000000-0000-4000-a810-000000000001'),
  current_setting('activity_test.t0')::timestamptz + interval '1 minute',
  'backfill: the latest purchase or redemption, cancelled ones included, corrections excluded');
select is(pg_temp.activity('00000000-0000-4000-a810-000000000002'),
  current_setting('activity_test.t0')::timestamptz + interval '5 minutes',
  'backfill: a cancelled purchase counts, its later correction does not');
select is(
  (select count(*)::int from app.customers c
   where c.last_activity_at is distinct from (
     select max(m.created_at) from app.movements m
     where m.customer_id = c.id and m.kind in ('purchase', 'redemption'))),
  0,
  'backfill: every customer (the seed included) has the max of its purchases and redemptions, null without'
);
select is(
  (select count(*)::int from app.customers c
   where c.last_activity_at is null
     and exists (select 1 from app.movements m
                 where m.customer_id = c.id and m.kind in ('purchase', 'redemption'))),
  0,
  'backfill: no customer with purchases or redemptions is left without activity'
);
select ok(
  not has_function_privilege('authenticated', 'private.backfill_customer_activity()', 'execute'),
  'authenticated cannot run the backfill'
);

-- Writes ---------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a800-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$update app.customers set last_activity_at = now()
    where id = '00000000-0000-4000-a810-000000000003'$$,
  '42501', null,
  'not even an admin writes last_activity_at: only the movements trigger does'
);
reset role;
select throws_ok(
  $$update app.customers set sort_at = now() where id = '00000000-0000-4000-a810-000000000003'$$,
  '428C9', null,
  'sort_at is generated: nobody writes it'
);

-- The home list index --------------------------------------------------------------------
select is(
  (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'customers_home_order_idx'),
  'CREATE INDEX customers_home_order_idx ON app.customers USING btree '
    || '(has_activity DESC, sort_at DESC, id DESC) WHERE (anonymized_at IS NULL)',
  'customers_home_order_idx orders by activity, then sort_at, then id, without anonymized rows'
);

-- The email column (migration 2) ---------------------------------------------------------
-- SPEC-customers-v2.md point 2: optional, stored lowercase and trimmed, 6–254 characters,
-- one @ and a dot after it; unique, several nulls allowed. Written directly here as
-- postgres; the customers RPCs that take it are tested further down.
select col_type_is('app', 'customers', 'email', 'text', 'email is text');
select col_is_null('app', 'customers', 'email', 'email is optional');
select is(
  (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'customers_email_key'),
  'CREATE UNIQUE INDEX customers_email_key ON app.customers USING btree (email)',
  'customers_email_key is a unique index on email'
);

create function pg_temp.set_email(p_customer text, p_email text) returns void language sql as $$
  update app.customers set email = p_email where id = p_customer::uuid;
$$;

select lives_ok(
  $$select pg_temp.set_email('00000000-0000-4000-a810-000000000001', 'ab@c.de')$$,
  'email: 6 characters, lowercase, one @ and a dot after it is accepted'
);
select throws_ok(
  $$select pg_temp.set_email('00000000-0000-4000-a810-000000000001', 'a@b.c')$$,
  '23514', 'new row for relation "customers" violates check constraint "customers_email_check"',
  'email: fewer than 6 characters is refused'
);
select lives_ok(
  format($$select pg_temp.set_email('00000000-0000-4000-a810-000000000001', %L)$$,
    repeat('a', 64) || '@' || repeat('b', 185) || '.com'),
  'email: 254 characters is accepted'
);
select throws_ok(
  format($$select pg_temp.set_email('00000000-0000-4000-a810-000000000001', %L)$$,
    repeat('a', 64) || '@' || repeat('b', 186) || '.com'),
  '23514', 'new row for relation "customers" violates check constraint "customers_email_check"',
  'email: 255 characters is refused'
);
select throws_ok(
  $$select pg_temp.set_email('00000000-0000-4000-a810-000000000001', 'Rossi@example.com')$$,
  '23514', 'new row for relation "customers" violates check constraint "customers_email_check"',
  'email: uppercase is refused (the stored form is lowercase)'
);
select throws_ok(
  $$select pg_temp.set_email('00000000-0000-4000-a810-000000000001', ' rossi@example.com')$$,
  '23514', 'new row for relation "customers" violates check constraint "customers_email_check"',
  'email: spaces at the edges are refused (the stored form is trimmed)'
);
select is(
  array(
    select e from unnest(array['rossi@example', 'rossiexample.com', 'ro ssi@example.com',
                               'rossi@@example.com', '@example.com', 'rossi@.com'
                              ]) as e
    where e ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  array[]::text[],
  'precondition: every malformed email below fails the format of the spec'
);
select throws_ok(
  format($$select pg_temp.set_email('00000000-0000-4000-a810-000000000001', %L)$$, e),
  '23514', 'new row for relation "customers" violates check constraint "customers_email_check"',
  'email: malformed ' || e || ' is refused'
)
from unnest(array['rossi@example', 'rossiexample.com', 'ro ssi@example.com',
                  'rossi@@example.com', '@example.com', 'rossi@.com']) as e;

select pg_temp.set_email('00000000-0000-4000-a810-000000000001', 'ada.attivita@example.com');
select throws_ok(
  $$select pg_temp.set_email('00000000-0000-4000-a810-000000000002', 'ada.attivita@example.com')$$,
  '23505', 'duplicate key value violates unique constraint "customers_email_key"',
  'email: two customers never share one'
);
select is(
  (select count(*)::int from app.customers where email is null) > 1,
  true,
  'email: several customers without an email are allowed'
);

-- app.list_customers ----------------------------------------------------------------------
-- SPEC-customers-v2.md point 6: keyset pages of the home list. Order: customers with a
-- purchase or a redemption first, latest first; then the others, latest creation first;
-- then id descending. Anonymized customers never listed.
--
-- Fake customers "Elenco" (filters):
--   E1 purchase at t0+3m, email elenco.uno@example.com
--   E2 purchase at t0-1h and redemption at t0+1m
--   E3 no movements, created t0-1d, email tuttoxsotto@example.com   (decoy for _)
--   E4 no movements, created t0-2d, email barxxcode.robo@example.com (decoy for % and \)
--   E5 no movements, created t0-3d, email per%cento_sotto\barra@example.com
--   E6 anonymized
insert into app.customers
  (id, name, email, privacy_consent_at, created_by, create_operation_id, created_at, anonymized_at)
select fake.id, fake.name, fake.email, now(), (select id from app.operators where name = 'Admin Attività'),
  gen_random_uuid(), current_setting('activity_test.t0')::timestamptz + fake.created, fake.anonymized
from (values
  ('00000000-0000-4000-a830-000000000001'::uuid, 'Elenco Uno', 'elenco.uno@example.com',
   interval '-30 days', null::timestamptz),
  ('00000000-0000-4000-a830-000000000002'::uuid, 'Elenco Due', null, interval '-30 days', null),
  ('00000000-0000-4000-a830-000000000003'::uuid, 'Elenco Tre', 'tuttoxsotto@example.com',
   interval '-1 day', null),
  ('00000000-0000-4000-a830-000000000004'::uuid, 'Elenco Quattro', 'barxxcode.robo@example.com',
   interval '-2 days', null),
  ('00000000-0000-4000-a830-000000000005'::uuid, 'Elenco Cinque', 'per%cento_sotto\barra@example.com',
   interval '-3 days', null),
  ('00000000-0000-4000-a830-000000000006'::uuid, 'Elenco Cancellato', null, interval '-1 hour', now())
) as fake (id, name, email, created, anonymized);

select pg_temp.add_movement('00000000-0000-4000-a840-000000000001',
  '00000000-0000-4000-a830-000000000001', 'purchase', interval '3 minutes');
select pg_temp.add_movement('00000000-0000-4000-a840-000000000002',
  '00000000-0000-4000-a830-000000000002', 'purchase', interval '-1 hour');
select pg_temp.add_movement('00000000-0000-4000-a840-000000000003',
  '00000000-0000-4000-a830-000000000002', 'redemption', interval '1 minute');
select pg_temp.add_movement('00000000-0000-4000-a840-000000000004',
  '00000000-0000-4000-a830-000000000006', 'purchase', interval '9 minutes');

-- Fake customers "Pagina" (keyset): two with the same last activity to the microsecond,
-- four created at the same microsecond, one created at the very instant of the others'
-- activity (it still comes after every customer with activity).
--   P8 / P7  activity t0+10m          P6 activity t0+5m
--   P1       no movements, created t0+10m
--   P5..P2   no movements, created t0-3d
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id, created_at)
select fake.id, fake.name, now(), (select id from app.operators where name = 'Admin Attività'),
  gen_random_uuid(), current_setting('activity_test.t0')::timestamptz + fake.created
from (values
  ('00000000-0000-4000-a850-000000000001'::uuid, 'Pagina Uno', interval '10 minutes'),
  ('00000000-0000-4000-a850-000000000002'::uuid, 'Pagina Due', interval '-3 days'),
  ('00000000-0000-4000-a850-000000000003'::uuid, 'Pagina Tre', interval '-3 days'),
  ('00000000-0000-4000-a850-000000000004'::uuid, 'Pagina Quattro', interval '-3 days'),
  ('00000000-0000-4000-a850-000000000005'::uuid, 'Pagina Cinque', interval '-3 days'),
  ('00000000-0000-4000-a850-000000000006'::uuid, 'Pagina Sei', interval '-30 days'),
  ('00000000-0000-4000-a850-000000000007'::uuid, 'Pagina Sette', interval '-30 days'),
  ('00000000-0000-4000-a850-000000000008'::uuid, 'Pagina Otto', interval '-30 days')
) as fake (id, name, created);

select pg_temp.add_movement('00000000-0000-4000-a860-000000000001',
  '00000000-0000-4000-a850-000000000008', 'purchase', interval '10 minutes');
select pg_temp.add_movement('00000000-0000-4000-a860-000000000002',
  '00000000-0000-4000-a850-000000000007', 'purchase', interval '10 minutes');
select pg_temp.add_movement('00000000-0000-4000-a860-000000000003',
  '00000000-0000-4000-a850-000000000006', 'purchase', interval '5 minutes');

-- A device account, for the refusal without a cashier.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a800-000000000003', 'activity.device@example.com'),
  ('00000000-0000-4000-a800-000000000004', 'activity.stranger@example.com');
select private.add_device('activity.device@example.com', 'Tablet Attività');

select is(
  (select (p.prosecdef, p.provolatile,
           p.proconfig @> array['search_path=""', 'plan_cache_mode=force_custom_plan'])::text
   from pg_proc p
   where p.oid = 'app.list_customers(text, timestamptz, timestamptz, uuid, int)'::regprocedure),
  '(t,s,t)',
  'list_customers is stable security definer, empty search_path, custom plans only'
);
select is(
  (select array_agg(x.name || ':' || format_type(x.typ, null) order by x.n)
   from pg_proc p,
     unnest(p.proallargtypes, p.proargnames, p.proargmodes) with ordinality as x (typ, name, mode, n)
   where p.oid = 'app.list_customers(text, timestamptz, timestamptz, uuid, int)'::regprocedure
     and x.mode = 't'),
  array['id:uuid', 'name:text', 'balance:integer', 'last_activity_at:timestamp with time zone',
        'created_at:timestamp with time zone'],
  'list_customers returns id, name, balance, last_activity_at, created_at (no email: plan.md)'
);
select ok(
  not has_function_privilege('anon', 'app.list_customers(text, timestamptz, timestamptz, uuid, int)', 'execute')
  and not has_function_privilege('public', 'app.list_customers(text, timestamptz, timestamptz, uuid, int)', 'execute')
  and has_function_privilege('authenticated', 'app.list_customers(text, timestamptz, timestamptz, uuid, int)', 'execute'),
  'list_customers: only authenticated may call it'
);

set local role authenticated;

-- Refusals: not_operator first, then the limit, then the cursor.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a800-000000000004","role":"authenticated"}', true);
select throws_ok($$select * from app.list_customers(null, null, null, null, 0)$$,
  'P0001', 'not_operator', 'list_customers: a user who is not an operator is refused first');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a800-000000000003","role":"authenticated"}', true);
select throws_ok($$select * from app.list_customers()$$,
  'P0001', 'not_operator', 'list_customers: a device without a cashier is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a800-000000000002","role":"authenticated"}', true);
select throws_ok($$select * from app.list_customers(null, null, null, null, 0)$$,
  '22023', 'invalid_limit', 'list_customers: a limit of 0 is refused');
select throws_ok($$select * from app.list_customers(null, null, null, null, 51)$$,
  '22023', 'invalid_limit', 'list_customers: a limit above 50 is refused');
select throws_ok($$select * from app.list_customers(null, null, null, null, null)$$,
  '22023', 'invalid_limit', 'list_customers: a null limit is refused');
select throws_ok($$select * from app.list_customers(null, now(), null, null)$$,
  '22023', 'invalid_cursor', 'list_customers: an activity without p_after_id is refused');
select throws_ok($$select * from app.list_customers(null, null, now(), null)$$,
  '22023', 'invalid_cursor', 'list_customers: a creation without p_after_id is refused');
select throws_ok($$select * from app.list_customers(null, null, null, gen_random_uuid())$$,
  '22023', 'invalid_cursor', 'list_customers: p_after_id without p_after_created_at is refused');
select throws_ok($$select * from app.list_customers(null, now(), null, gen_random_uuid())$$,
  '22023', 'invalid_cursor', 'list_customers: p_after_id with an activity but no creation is refused');

-- Order and filters, as an operator.
select is(
  array(select r.name from app.list_customers('Elenco', null, null, null, 50) r),
  array['Elenco Uno', 'Elenco Due', 'Elenco Tre', 'Elenco Quattro', 'Elenco Cinque'],
  'order: latest activity first (a redemption counts), then without movements by creation; anonymized never'
);
select is(
  (select array_agg(r.balance || ':' || coalesce(r.last_activity_at::text, '-') order by r.name)
   from app.list_customers('Elenco Due', null, null, null, 50) r),
  array['5:' || (current_setting('activity_test.t0')::timestamptz + interval '1 minute')::text],
  'each row carries its balance and last activity'
);
select is(
  (select count(*)::int from app.list_customers(null, null, null, null, 50) r
   where r.id = '00000000-0000-4000-a830-000000000006'
      or r.name like 'Cliente cancellato%'),
  0,
  'anonymized customers are never listed, even without a filter'
);
select is(
  array(select r.name from app.list_customers('uno elenco', null, null, null, 50) r),
  array['Elenco Uno'],
  'filter by name: every word, in any order, in the name key'
);
select is(
  array(select r.name from app.list_customers('  ÈLENCO   quattro ', null, null, null, 50) r),
  array['Elenco Quattro'],
  'filter by name: through clean_name and the name key (spaces, accents, case)'
);
select is(
  array(select r.name from app.list_customers('uno@exa', null, null, null, 50) r),
  array['Elenco Uno'],
  'filter by email: part of the email'
);
select is(
  array(select r.name from app.list_customers('ELENCO.UNO@', null, null, null, 50) r),
  array['Elenco Uno'],
  'filter by email: the text is lowercased'
);
select is(
  array(select r.name from app.list_customers('o_s', null, null, null, 50) r),
  array['Elenco Cinque'],
  'filter by email: _ is searched literally'
);
select is(
  array(select r.name from app.list_customers('r%c', null, null, null, 50) r),
  array['Elenco Cinque'],
  'filter by email: % is searched literally'
);
select is(
  array(select r.name from app.list_customers('o\b', null, null, null, 50) r),
  array['Elenco Cinque'],
  'filter by email: \ is searched literally'
);
select is(
  array(select r.name from app.list_customers('Elenco Uno' || repeat(' ', 70) || 'zzz', null, null, null, 50) r),
  array['Elenco Uno'],
  'the text is cut at 80 characters before clean_name: what follows is not searched'
);
select is(
  array(select r.id from app.list_customers('  e ', null, null, null, 50) r),
  array(select r.id from app.list_customers(null, null, null, null, 50) r),
  'fewer than 2 characters (after clean_name) is the full list'
);
select is(
  array(select r.id from app.list_customers('', null, null, null, 50) r),
  array(select r.id from app.list_customers(null, null, null, null, 50) r),
  'an empty text is the full list'
);

-- Keyset: three pages of 3, then an empty one, cursor sent back as received (JSON text,
-- microseconds included, as PostgREST does).
select is(
  array(select r.id::text from app.list_customers('Pagina', null, null, null, 50) r),
  array['00000000-0000-4000-a850-000000000008', '00000000-0000-4000-a850-000000000007',
        '00000000-0000-4000-a850-000000000006', '00000000-0000-4000-a850-000000000001',
        '00000000-0000-4000-a850-000000000005', '00000000-0000-4000-a850-000000000004',
        '00000000-0000-4000-a850-000000000003', '00000000-0000-4000-a850-000000000002'],
  'order with ties to the microsecond: activity, then sort_at, then id descending'
);

select set_config('list_test.page1', (
  select json_agg(row_to_json(r) order by r.n)::text
  from app.list_customers('Pagina', null, null, null, 3) with ordinality r (id, name, balance,
    last_activity_at, created_at, n)
), true);
select set_config('list_test.page2', (
  select json_agg(row_to_json(r) order by r.n)::text
  from app.list_customers('Pagina',
    (current_setting('list_test.page1')::json -> -1 ->> 'last_activity_at')::timestamptz,
    (current_setting('list_test.page1')::json -> -1 ->> 'created_at')::timestamptz,
    (current_setting('list_test.page1')::json -> -1 ->> 'id')::uuid, 3)
    with ordinality r (id, name, balance, last_activity_at, created_at, n)
), true);
select set_config('list_test.page3', (
  select json_agg(row_to_json(r) order by r.n)::text
  from app.list_customers('Pagina',
    (current_setting('list_test.page2')::json -> -1 ->> 'last_activity_at')::timestamptz,
    (current_setting('list_test.page2')::json -> -1 ->> 'created_at')::timestamptz,
    (current_setting('list_test.page2')::json -> -1 ->> 'id')::uuid, 3)
    with ordinality r (id, name, balance, last_activity_at, created_at, n)
), true);
select set_config('list_test.page4', coalesce((
  select json_agg(row_to_json(r) order by r.n)::text
  from app.list_customers('Pagina',
    (current_setting('list_test.page3')::json -> -1 ->> 'last_activity_at')::timestamptz,
    (current_setting('list_test.page3')::json -> -1 ->> 'created_at')::timestamptz,
    (current_setting('list_test.page3')::json -> -1 ->> 'id')::uuid, 3)
    with ordinality r (id, name, balance, last_activity_at, created_at, n)
), '[]'), true);

select is(
  array[json_array_length(current_setting('list_test.page1')::json),
        json_array_length(current_setting('list_test.page2')::json),
        json_array_length(current_setting('list_test.page3')::json),
        json_array_length(current_setting('list_test.page4')::json)],
  array[3, 3, 2, 0],
  'keyset: pages of 3, 3 and 2 rows, then an empty one'
);
select is(
  array(
    select e ->> 'id'
    from unnest(array['list_test.page1', 'list_test.page2', 'list_test.page3']) with ordinality p (k, pn),
      json_array_elements(current_setting(p.k)::json) with ordinality j (e, n)
    order by p.pn, j.n
  ),
  array(select r.id::text from app.list_customers('Pagina', null, null, null, 50) r),
  'keyset: the three pages are the whole list, without duplicates or gaps'
);
select is(
  (current_setting('list_test.page1')::json -> -1 ->> 'last_activity_at')::timestamptz,
  current_setting('activity_test.t0')::timestamptz + interval '5 minutes',
  'keyset: the cursor keeps the microseconds'
);

reset role;

-- The email in the customers RPCs (migration 2, final form) -------------------------------
-- SPEC-customers-v2.md point 2 and acceptance criteria 2 and 3. Called by parameter name,
-- the way the app calls them: these calls hold for the final form too.
-- Fake customers "Posta", created by the RPCs as the operator.

-- The message and the detail of the error a statement raises, or null when it succeeds.
create function pg_temp.error_of(p_sql text) returns text language plpgsql as $$
declare
  v_message text;
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
  return v_message || ' | ' || coalesce(v_detail, '');
end;
$$;
grant execute on function pg_temp.error_of(text) to authenticated;

-- Criterion 1: no customer phone left in the schema (migration 2, final form).
select hasnt_column('app', 'customers', 'phone', 'app.customers has no phone column');
select hasnt_function('private', 'normalize_phone', 'private.normalize_phone is gone');
select hasnt_function('app', 'search_customers', 'app.search_customers is gone');
select hasnt_function('app', 'customers_served_today', 'app.customers_served_today is gone');
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'app.customer_summary'::regclass and attnum > 0 and not attisdropped),
  array['id', 'name', 'email', 'notes', 'anonymized_at', 'balance', 'last_served_at'],
  'customer_summary carries email in the place of the phone'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'app.customer_summary'::regclass and attnum > 0 and attisdropped),
  null,
  'customer_summary: the phone was renamed, not dropped (no hidden attribute)'
);
-- The final signatures: p_email in the place of p_phone, no defaults, nothing else.
select is(
  (select array_agg(p.oid::regprocedure::text || ' ' || array_to_string(p.proargnames, ',')
          || ' defaults=' || p.pronargdefaults order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('create_customer', 'update_customer', 'create_customer_with_card')),
  array[
    'app.create_customer(uuid,text,text,boolean,text) '
      || 'p_operation_id,p_name,p_email,p_privacy_consent,p_notes defaults=0',
    'app.create_customer_with_card(uuid,text,text,boolean,text,text) '
      || 'p_operation_id,p_name,p_email,p_privacy_consent,p_notes,p_uid defaults=0',
    'app.update_customer(uuid,text,text,text) p_customer_id,p_name,p_email,p_notes defaults=0'
  ],
  'create_customer, update_customer and create_customer_with_card: one final signature each'
);
select ok(
  has_function_privilege('authenticated', 'app.create_customer(uuid, text, text, boolean, text)', 'execute')
  and has_function_privilege('authenticated', 'app.update_customer(uuid, text, text, text)', 'execute')
  and has_function_privilege('authenticated',
    'app.create_customer_with_card(uuid, text, text, boolean, text, text)', 'execute')
  and has_function_privilege('authenticated', 'app.export_customers(uuid, int)', 'execute'),
  'authenticated executes the final signatures'
);
select ok(
  not has_function_privilege('anon', 'app.create_customer(uuid, text, text, boolean, text)', 'execute')
  and not has_function_privilege('anon', 'app.update_customer(uuid, text, text, text)', 'execute')
  and not has_function_privilege('anon',
    'app.create_customer_with_card(uuid, text, text, boolean, text, text)', 'execute')
  and not has_function_privilege('anon', 'app.export_customers(uuid, int)', 'execute'),
  'anon executes none of the final signatures'
);
select is(
  pg_get_function_result('app.export_customers(uuid, int)'::regprocedure),
  'TABLE(id uuid, name text, email text, active_card_uid text, balance_points integer, '
    || 'privacy_consent_at timestamp with time zone, notes text, created_at timestamp with time zone, '
    || 'created_by_name text, anonymized_at timestamp with time zone)',
  'export_customers returns the email in the place of the phone'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'private', 'public')
     and (p.prosrc ~* '\mphone\M' or array_to_string(p.proargnames, ',') ~* 'phone')),
  0,
  'no function of app, private or public mentions a phone any more'
);
select ok(
  not has_function_privilege('anon', 'private.normalize_email(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.normalize_email(text)', 'execute'),
  'no API role executes normalize_email'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a800-000000000002","role":"authenticated"}', true);

select is(
  (select row(s.name, s.email)::text from app.create_customer(
     p_operation_id => '00000000-0000-4000-a820-000000000001', p_name => 'Posta Rossi',
     p_email => '  Rossi@Example.COM ', p_privacy_consent => true, p_notes => null) s),
  '("Posta Rossi",rossi@example.com)',
  'create_customer: the email is trimmed and lowercased'
);
select is(
  (select email from app.customers where create_operation_id = '00000000-0000-4000-a820-000000000001'),
  'rossi@example.com',
  'create_customer: the email is stored normalized'
);
select is(
  (select email from app.create_customer(
     p_operation_id => '00000000-0000-4000-a820-000000000001', p_name => 'Posta Rossi',
     p_email => '  Rossi@Example.COM ', p_privacy_consent => true, p_notes => null)),
  'rossi@example.com',
  'create_customer: a resent operation returns the email too'
);
select is(
  (select email from app.get_customer(
     (select id from app.customers where create_operation_id = '00000000-0000-4000-a820-000000000001'))),
  'rossi@example.com',
  'get_customer returns the email'
);
select is(
  (select email from app.create_customer(
     p_operation_id => gen_random_uuid(), p_name => 'Posta Unicode',
     p_email => E' 　Unicode@Example.COM ​﻿\t', p_privacy_consent => true,
     p_notes => null)),
  'unicode@example.com',
  'create_customer: Unicode spaces at the edges are trimmed too'
);
select is(
  pg_temp.error_of($$select app.create_customer(p_operation_id => gen_random_uuid(),
    p_name => 'Posta Bianchi', p_email => 'ROSSI@example.com', p_privacy_consent => true,
    p_notes => null)$$),
  'customer_email_taken | '
    || (select id::text from app.customers
        where create_operation_id = '00000000-0000-4000-a820-000000000001'),
  'create_customer: the same email in other case is taken, detail = the other customer''s id'
);
select throws_ok(
  $$select app.create_customer(p_operation_id => gen_random_uuid(), p_name => 'Posta Bianchi',
    p_email => 'rossi@', p_privacy_consent => true, p_notes => null)$$,
  'P0001', 'email_invalid',
  'create_customer: a malformed email is refused'
);
select throws_ok(
  $$select app.create_customer(p_operation_id => gen_random_uuid(), p_name => 'Posta Bianchi',
    p_email => 'a@b.c', p_privacy_consent => true, p_notes => null)$$,
  'P0001', 'email_invalid',
  'create_customer: an email shorter than 6 characters is refused'
);
select throws_ok(
  format($$select app.create_customer(p_operation_id => gen_random_uuid(), p_name => 'Posta Bianchi',
    p_email => %L, p_privacy_consent => true, p_notes => null)$$,
    repeat('a', 64) || '@' || repeat('b', 186) || '.com'),
  'P0001', 'email_invalid',
  'create_customer: an email longer than 254 characters is refused'
);
select is(
  pg_temp.error_of($$select app.create_customer(p_operation_id => gen_random_uuid(),
    p_name => 'posta rossi', p_email => 'rossi@example.com', p_privacy_consent => true,
    p_notes => null)$$),
  'customer_name_taken | '
    || (select id::text from app.customers
        where create_operation_id = '00000000-0000-4000-a820-000000000001'),
  'create_customer: name and email both taken → only customer_name_taken (the first check)'
);
select is(
  pg_temp.error_of($$select app.create_customer(p_operation_id => gen_random_uuid(),
    p_name => 'Posta Rossi', p_email => 'rossi@', p_privacy_consent => true, p_notes => null)$$),
  'customer_name_taken | '
    || (select id::text from app.customers
        where create_operation_id = '00000000-0000-4000-a820-000000000001'),
  'create_customer: a taken name is reported before a malformed email'
);
select is(
  (select array_agg(s.email is null) from (
     select email from app.create_customer(p_operation_id => gen_random_uuid(),
       p_name => 'Posta Senza Uno', p_email => null, p_privacy_consent => true, p_notes => null)
     union all
     select email from app.create_customer(p_operation_id => gen_random_uuid(),
       p_name => 'Posta Senza Due', p_email => E'  ', p_privacy_consent => true, p_notes => null)
   ) s),
  array[true, true],
  'create_customer: two customers without an email (null, or only spaces)'
);
select throws_ok(
  $$select app.create_customer(p_operation_id => gen_random_uuid(), p_name => 'Posta Vecchio Frontend',
    p_phone => null, p_privacy_consent => true, p_notes => null)$$,
  '42883', null,
  'create_customer: a call with p_phone (the old frontend) finds no function'
);

-- update_customer
select set_config('email_test.bianchi', (select id::text from app.create_customer(
  p_operation_id => gen_random_uuid(), p_name => 'Posta Bianchi', p_email => 'bianchi@example.com',
  p_privacy_consent => true, p_notes => null)), true);
select is(
  (select email from app.update_customer(p_customer_id => current_setting('email_test.bianchi')::uuid,
     p_name => 'Posta Bianchi Due', p_email => 'BIANCHI@example.com ', p_notes => null)),
  'bianchi@example.com',
  'update_customer: renaming with its own email (any case) is not a conflict'
);
select is(
  pg_temp.error_of($$select app.update_customer(p_customer_id => current_setting('email_test.bianchi')::uuid,
    p_name => 'Posta Bianchi Due', p_email => ' Rossi@Example.com', p_notes => null)$$),
  'customer_email_taken | '
    || (select id::text from app.customers
        where create_operation_id = '00000000-0000-4000-a820-000000000001'),
  'update_customer: another customer''s email is taken, detail = their id'
);
select throws_ok(
  $$select app.update_customer(p_customer_id => current_setting('email_test.bianchi')::uuid,
    p_name => 'Posta Bianchi Due', p_email => 'bianchi@example', p_notes => null)$$,
  'P0001', 'email_invalid',
  'update_customer: a malformed email is refused'
);
select is(
  pg_temp.error_of($$select app.update_customer(p_customer_id => current_setting('email_test.bianchi')::uuid,
    p_name => 'Posta Rossi', p_email => 'rossi@example.com', p_notes => null)$$),
  'customer_name_taken | '
    || (select id::text from app.customers
        where create_operation_id = '00000000-0000-4000-a820-000000000001'),
  'update_customer: name and email both taken → only customer_name_taken'
);
select is(
  (select email from app.update_customer(p_customer_id => current_setting('email_test.bianchi')::uuid,
     p_name => 'Posta Bianchi Due', p_email => '   ', p_notes => null)),
  null,
  'update_customer: an empty email removes it'
);
select is(
  (select email from app.customers where id = current_setting('email_test.bianchi')::uuid),
  null,
  'update_customer: the removed email is no longer stored'
);

-- create_customer_with_card
select is(
  (select email from app.create_customer_with_card(p_operation_id => gen_random_uuid(),
     p_name => 'Posta Card', p_email => ' Card@Example.com', p_privacy_consent => true, p_notes => null,
     p_uid => '04EE0000000E01')),
  'card@example.com',
  'create_customer_with_card: the email is normalized and returned'
);
select is(
  pg_temp.error_of($$select app.create_customer_with_card(p_operation_id => gen_random_uuid(),
    p_name => 'Posta Card Due', p_email => 'CARD@example.com', p_privacy_consent => true,
    p_notes => null, p_uid => '04EE0000000E02')$$),
  'customer_email_taken | ' || (select id::text from app.customers where name = 'Posta Card'),
  'create_customer_with_card: a taken email is refused with the other customer''s id'
);
select is(
  (select count(*)::int from app.cards where uid = '04EE0000000E02'),
  0,
  'create_customer_with_card: a refused email leaves no card behind'
);
select throws_ok(
  $$select app.create_customer_with_card(p_operation_id => gen_random_uuid(),
    p_name => 'Posta Card Due', p_email => '@example.com', p_privacy_consent => true,
    p_notes => null, p_uid => '04EE0000000E02')$$,
  'P0001', 'email_invalid',
  'create_customer_with_card: a malformed email is refused'
);

-- Criterion 3: the erasure clears name, email and notes; the email is free again.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a800-000000000001","role":"authenticated"}', true);
select set_config('email_test.erased', (select id::text from app.create_customer(
  p_operation_id => gen_random_uuid(), p_name => 'Posta Cancellata', p_email => 'via@example.com',
  p_privacy_consent => true, p_notes => 'Nota di prova')), true);
select is(
  (select row(s.name like 'Cliente cancellato %', s.email, s.notes, s.anonymized_at is not null)::text
   from app.anonymize_customer(current_setting('email_test.erased')::uuid) s),
  '(t,,,t)',
  'anonymize_customer: name replaced, email and notes cleared'
);
select is(
  (select row(name like 'Cliente cancellato %', email, notes)::text
   from app.customers where id = current_setting('email_test.erased')::uuid),
  '(t,,)',
  'anonymize_customer: the stored row keeps neither name, email nor notes'
);
select is(
  (select email from app.create_customer(p_operation_id => gen_random_uuid(),
     p_name => 'Posta Riusa', p_email => 'VIA@example.com', p_privacy_consent => true, p_notes => null)),
  'via@example.com',
  'after the erasure another customer reuses the email'
);
select is(
  (select email from app.get_customer(current_setting('email_test.erased')::uuid)),
  null,
  'get_customer: the anonymized customer has no email'
);

-- export_customers
select is(
  (select e.email from app.export_customers(null, 1000) e
   where e.id = (select id from app.customers where create_operation_id = '00000000-0000-4000-a820-000000000001')),
  'rossi@example.com',
  'export_customers: the admin receives the email'
);
select is(
  (select e.email from app.export_customers(null, 1000) e
   where e.id = current_setting('email_test.erased')::uuid),
  null,
  'export_customers: an anonymized customer has no email'
);

reset role;

select * from finish();
rollback;
