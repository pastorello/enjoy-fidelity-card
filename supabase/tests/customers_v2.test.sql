-- customers-v2: the last activity of a customer (SPEC-customers-v2.md, "Ultima attività
-- denormalizzata"): last_activity_at written only by the movements trigger, its generated
-- columns, the backfill and the home list index. Fake data only: invented names,
-- @example.com emails.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

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

select * from finish();
rollback;
