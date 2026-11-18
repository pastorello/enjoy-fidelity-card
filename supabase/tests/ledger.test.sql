-- ledger: the movements history, its access rules, the triggers that keep it
-- append-only, the balance and the history view (SPEC-ledger.md, "Modello dati e
-- regole di accesso"). Fake data only: invented names and @example.com emails.
begin;
create extension if not exists pgtap with schema extensions;
select plan(89);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-9000-000000000001', 'ledger.admin@example.com'),
  ('00000000-0000-4000-9000-000000000002', 'ledger.operator@example.com'),
  ('00000000-0000-4000-9000-000000000003', 'ledger.nobody@example.com');
select private.add_operator('ledger.admin@example.com', 'Admin Movimenti', 'admin');
select private.add_operator('ledger.operator@example.com', 'Operatore Movimenti', 'operator');

-- Fake customers: Lucia gets movements, Bruno has none, Carla buys through
-- record_purchase, Dario's data have been erased.
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id, anonymized_at)
select fake.id, fake.name, now(), (select id from app.operators where name = 'Admin Movimenti'), fake.op,
  fake.anonymized_at
from (values
  ('00000000-0000-4000-9100-000000000001'::uuid, 'Lucia Movimenti',
   '00000000-0000-4000-9200-000000000001'::uuid, null::timestamptz),
  ('00000000-0000-4000-9100-000000000002'::uuid, 'Bruno Movimenti',
   '00000000-0000-4000-9200-000000000002'::uuid, null::timestamptz),
  ('00000000-0000-4000-9100-000000000003'::uuid, 'Carla Spese',
   '00000000-0000-4000-9200-000000000003'::uuid, null::timestamptz),
  ('00000000-0000-4000-9100-000000000004'::uuid, 'Cliente cancellato 00000000',
   '00000000-0000-4000-9200-000000000004'::uuid, now())
) as fake (id, name, op, anonymized_at);

-- A fake reward for the catalogue redemption.
insert into app.rewards (id, name, points, created_by, updated_by)
select '00000000-0000-4000-9400-000000000001', 'Caffè di prova', 10, o.id, o.id
from app.operators o where o.name = 'Admin Movimenti';

-- Movements inserted as postgres (the RPCs come in later tasks): a purchase of
-- 12,50 € at 100 cents per point by the operator, a catalogue redemption, a free
-- redemption, and the admin's correction of the free redemption.
insert into app.movements
  (id, operation_id, customer_id, kind, amount_cents, points, cents_per_point, reward_id,
   description, operator_id, created_at, corrects_movement_id)
values
  ('00000000-0000-4000-9300-000000000001', '00000000-0000-4000-9500-000000000001',
   '00000000-0000-4000-9100-000000000001', 'purchase', 1250, 12, 100, null, null,
   (select id from app.operators where name = 'Operatore Movimenti'),
   '2026-11-18 10:00:00+01', null),
  ('00000000-0000-4000-9300-000000000002', '00000000-0000-4000-9500-000000000002',
   '00000000-0000-4000-9100-000000000001', 'redemption', null, -10, null,
   '00000000-0000-4000-9400-000000000001', 'Caffè di prova',
   (select id from app.operators where name = 'Operatore Movimenti'),
   '2026-11-18 10:05:00+01', null),
  ('00000000-0000-4000-9300-000000000003', '00000000-0000-4000-9500-000000000003',
   '00000000-0000-4000-9100-000000000001', 'redemption', null, -2, null, null, 'Cornetto di prova',
   (select id from app.operators where name = 'Operatore Movimenti'),
   '2026-11-18 10:10:00+01', null),
  ('00000000-0000-4000-9300-000000000004', '00000000-0000-4000-9500-000000000004',
   '00000000-0000-4000-9100-000000000001', 'correction', null, 2, null, null, null,
   (select id from app.operators where name = 'Admin Movimenti'),
   '2026-11-18 11:00:00+01', '00000000-0000-4000-9300-000000000003');

-- Structure ----------------------------------------------------------------------------------
select has_table('app', 'movements', 'app.movements exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'app.movements'::regclass),
  'RLS is enabled on app.movements'
);
select col_is_unique('app', 'movements', 'operation_id', 'operation_id is unique');
select col_is_unique('app', 'movements', 'corrects_movement_id', 'corrects_movement_id is unique');
select is(
  (select confdeltype from pg_constraint
   where conrelid = 'app.movements'::regclass and contype = 'f'
     and confrelid = 'app.rewards'::regclass),
  'a'::"char",
  'reward_id does not cascade (no action)'
);
select is(
  (select confdeltype from pg_constraint
   where conrelid = 'app.movements'::regclass and contype = 'f'
     and confrelid = 'app.customers'::regclass),
  'r'::"char",
  'customer_id is on delete restrict'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'app' and tablename = 'movements'
      and indexdef like '%(customer_id, created_at DESC)'
  ),
  'index on (customer_id, created_at desc)'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'app' and tablename = 'movements'
      and indexdef like '%(created_at, id)'
  ),
  'index on (created_at, id)'
);
select has_type('app', 'ledger_result', 'app.ledger_result exists');
select is(
  array(
    select a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod)
    from pg_attribute a
    where a.attrelid = (select typrelid from pg_type where oid = 'app.ledger_result'::regtype)
      and a.attnum > 0 and not a.attisdropped
    order by a.attnum
  ),
  array['movement app.movement_history', 'balance integer'],
  'ledger_result is (movement app.movement_history, balance int)'
);
select ok(
  (select reloptions from pg_class where oid = 'app.movement_history'::regclass)
    @> array['security_invoker=true'],
  'movement_history is security_invoker'
);

-- Privileges -----------------------------------------------------------------------------------
select ok(
  has_table_privilege('authenticated', 'app.movements', 'select'),
  'authenticated has select on app.movements'
);
select ok(
  not has_table_privilege('authenticated', 'app.movements', 'insert')
    and not has_table_privilege('authenticated', 'app.movements', 'update')
    and not has_table_privilege('authenticated', 'app.movements', 'delete')
    and not has_table_privilege('authenticated', 'app.movements', 'truncate'),
  'authenticated has no insert, update, delete or truncate on app.movements'
);
select ok(
  not has_table_privilege('anon', 'app.movements', 'select')
    and not has_table_privilege('anon', 'app.movements', 'insert')
    and not has_table_privilege('anon', 'app.movements', 'update')
    and not has_table_privilege('anon', 'app.movements', 'delete')
    and not has_table_privilege('anon', 'app.movements', 'truncate'),
  'anon has no privilege on app.movements'
);
select ok(
  has_table_privilege('authenticated', 'app.movement_history', 'select'),
  'authenticated has select on movement_history'
);
select ok(
  not has_table_privilege('authenticated', 'app.movement_history', 'insert')
    and not has_table_privilege('authenticated', 'app.movement_history', 'update')
    and not has_table_privilege('authenticated', 'app.movement_history', 'delete')
    and not has_table_privilege('authenticated', 'app.movement_history', 'truncate'),
  'authenticated can only select from movement_history'
);
select ok(
  not has_table_privilege('anon', 'app.movement_history', 'select'),
  'anon has no select on movement_history'
);
select ok(
  not has_function_privilege('authenticated', 'private.customer_balance(uuid)', 'execute')
    and not has_function_privilege('anon', 'private.customer_balance(uuid)', 'execute'),
  'neither authenticated nor anon execute customer_balance'
);
select is(
  (select proconfig from pg_proc where oid = 'private.customer_balance(uuid)'::regprocedure),
  array['search_path=""'],
  'customer_balance pins an empty search_path'
);

-- customer_balance -------------------------------------------------------------------------
select is(
  private.customer_balance('00000000-0000-4000-9100-000000000002'),
  0,
  'a customer without movements has balance 0'
);
select is(
  private.customer_balance('00000000-0000-4000-9100-000000000001'),
  2,
  'the balance is the sum of every movement, the cancelled one and its correction included'
);
select is(
  pg_typeof(private.customer_balance('00000000-0000-4000-9100-000000000001'))::text,
  'integer',
  'customer_balance returns int'
);

-- Append-only, even for postgres (criterion 6) --------------------------------------------------
select throws_ok(
  $$update app.movements set points = 100 where id = '00000000-0000-4000-9300-000000000001'$$,
  '42501',
  'app.movements is append-only: movements are never updated or deleted',
  'postgres cannot update a movement'
);
select throws_ok(
  $$delete from app.movements where id = '00000000-0000-4000-9300-000000000001'$$,
  '42501',
  'app.movements is append-only: movements are never updated or deleted',
  'postgres cannot delete a movement'
);
select throws_ok(
  $$truncate app.movements cascade$$,
  '42501',
  'app.movements is append-only: movements are never updated or deleted',
  'postgres cannot truncate app.movements'
);
select is(
  (select count(*) from app.movements),
  4::bigint,
  'the movements are all still there'
);

-- Checks per kind (criterion 6) ------------------------------------------------------------------
-- Each statement tries one incoherent row; 23514 is check_violation.
create function pg_temp.bad_movement(
  p_kind text, p_amount int, p_points int, p_cpp int, p_reward uuid, p_description text,
  p_corrects uuid
) returns text
language sql
as $$
  select format(
    $f$insert into app.movements
         (operation_id, customer_id, kind, amount_cents, points, cents_per_point, reward_id,
          description, operator_id, corrects_movement_id)
       values (gen_random_uuid(), '00000000-0000-4000-9100-000000000002', %L, %L, %L, %L, %L, %L,
          (select id from app.operators where name = 'Admin Movimenti'), %L)$f$,
    p_kind, p_amount, p_points, p_cpp, p_reward, p_description, p_corrects
  );
$$;

select throws_ok(pg_temp.bad_movement('gift', null, 1, null, null, null, null), '23514', null,
  'an unknown kind is rejected');
select throws_ok(pg_temp.bad_movement('purchase', null, 0, 100, null, null, null), '23514', null,
  'a purchase without amount is rejected');
select throws_ok(pg_temp.bad_movement('purchase', 0, 0, 100, null, null, null), '23514', null,
  'a purchase of 0 cents is rejected');
select throws_ok(pg_temp.bad_movement('purchase', 10000000, 100000, 100, null, null, null), '23514', null,
  'a purchase of 10.000.000 cents is rejected');
select throws_ok(pg_temp.bad_movement('purchase', 1250, 12, null, null, null, null), '23514', null,
  'a purchase without the ratio in force is rejected');
select throws_ok(pg_temp.bad_movement('purchase', 1250, 12, 0, null, null, null), '23514', null,
  'a purchase with ratio 0 is rejected');
select throws_ok(pg_temp.bad_movement('purchase', 1250, 13, 100, null, null, null), '23514', null,
  'a purchase whose points are not floor(amount / ratio) is rejected');
select throws_ok(pg_temp.bad_movement('purchase', 1250, 12, 100, '00000000-0000-4000-9400-000000000001',
  null, null), '23514', null, 'a purchase with a reward is rejected');
select throws_ok(pg_temp.bad_movement('purchase', 1250, 12, 100, null, 'Spesa', null), '23514', null,
  'a purchase with a description is rejected');
select throws_ok(pg_temp.bad_movement('purchase', 1250, 12, 100, null, null,
  '00000000-0000-4000-9300-000000000002'), '23514', null, 'a purchase that corrects is rejected');
select throws_ok(pg_temp.bad_movement('redemption', null, 0, null, null, 'Premio', null), '23514', null,
  'a redemption of 0 points is rejected');
select throws_ok(pg_temp.bad_movement('redemption', null, 5, null, null, 'Premio', null), '23514', null,
  'a redemption that adds points is rejected');
select throws_ok(pg_temp.bad_movement('redemption', null, -100000, null, null, 'Premio', null), '23514',
  null, 'a redemption of 100000 points is rejected');
select throws_ok(pg_temp.bad_movement('redemption', null, -5, null, null, null, null), '23514', null,
  'a redemption without description is rejected');
select throws_ok(pg_temp.bad_movement('redemption', null, -5, null, null, '   ', null), '23514', null,
  'a redemption with a blank description is rejected');
select throws_ok(pg_temp.bad_movement('redemption', null, -5, null, null, repeat('x', 81), null), '23514',
  null, 'a redemption with an 81-character description is rejected');
select throws_ok(pg_temp.bad_movement('redemption', 500, -5, null, null, 'Premio', null), '23514', null,
  'a redemption with an amount is rejected');
select throws_ok(pg_temp.bad_movement('redemption', null, -5, 100, null, 'Premio', null), '23514', null,
  'a redemption with a ratio is rejected');
select throws_ok(pg_temp.bad_movement('correction', null, 12, null, null, null, null), '23514', null,
  'a correction without the corrected movement is rejected');
select throws_ok(pg_temp.bad_movement('correction', 1250, -12, null, null, null,
  '00000000-0000-4000-9300-000000000001'), '23514', null, 'a correction with an amount is rejected');
select throws_ok(pg_temp.bad_movement('correction', null, 10, null, null, 'Annullo',
  '00000000-0000-4000-9300-000000000002'), '23514', null, 'a correction with a description is rejected');
select throws_ok(pg_temp.bad_movement('correction', null, 10, null,
  '00000000-0000-4000-9400-000000000001', null, '00000000-0000-4000-9300-000000000002'), '23514', null,
  'a correction with a reward is rejected');
select throws_ok(pg_temp.bad_movement('correction', null, -2, null, null, null,
  '00000000-0000-4000-9300-000000000003'), '23505', null,
  'a movement is corrected at most once (unique corrects_movement_id)');
select lives_ok(pg_temp.bad_movement('purchase', 99, 0, 100, null, null, null),
  'a coherent purchase worth 0 points is accepted');

-- Access as an active operator ------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-9000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*) from app.movements where customer_id = '00000000-0000-4000-9100-000000000001'),
  4::bigint,
  'an active operator reads the movements'
);
select results_eq(
  $$select kind, points, operator_name, cancelled_by_id, cancelled_at, corrected_kind, corrected_created_at
    from app.movement_history
    where customer_id = '00000000-0000-4000-9100-000000000001'
    order by created_at$$,
  $$values
    ('purchase'::text, 12, 'Operatore Movimenti'::text, null::uuid, null::timestamptz, null::text,
     null::timestamptz),
    ('redemption', -10, 'Operatore Movimenti', null, null, null, null),
    ('redemption', -2, 'Operatore Movimenti',
     (select id from app.operators where name = 'Admin Movimenti'), '2026-11-18 11:00:00+01', null, null),
    ('correction', 2, 'Admin Movimenti', null, null, 'redemption', '2026-11-18 10:10:00+01')$$,
  'the view names the operator, who cancelled and when, and what a correction cancelled'
);
select throws_ok(
  $$insert into app.movements (operation_id, customer_id, kind, amount_cents, points, cents_per_point,
      operator_id)
    values (gen_random_uuid(), '00000000-0000-4000-9100-000000000002', 'purchase', 1000, 10, 100,
      (select private.current_operator_id()))$$,
  '42501',
  null,
  'an operator cannot insert a movement directly'
);
select throws_ok(
  $$update app.movements set points = 100$$,
  '42501',
  null,
  'an operator cannot update movements directly'
);
select throws_ok(
  $$delete from app.movements$$,
  '42501',
  null,
  'an operator cannot delete movements directly'
);
select throws_ok(
  $$truncate app.movements$$,
  '42501',
  null,
  'an operator cannot truncate movements'
);

-- A signed-in user without an operator profile reads nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*) from app.movements) + (select count(*) from app.movement_history),
  0::bigint,
  'a user without an operator profile reads no movements and no history'
);
reset role;

-- anon cannot even reach the table or the view.
set local role anon;
select throws_ok($$select count(*) from app.movements$$, '42501', null, 'anon cannot read movements');
select throws_ok($$select count(*) from app.movement_history$$, '42501', null,
  'anon cannot read the history');
reset role;

-- record_purchase -------------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'app.record_purchase(uuid, uuid, int)', 'execute'),
  'authenticated executes record_purchase'
);
select ok(
  not has_function_privilege('anon', 'app.record_purchase(uuid, uuid, int)', 'execute')
    and not exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where p.oid = 'app.record_purchase(uuid, uuid, int)'::regprocedure
        and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ),
  'neither anon nor PUBLIC execute record_purchase'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']
   from pg_proc where oid = 'app.record_purchase(uuid, uuid, int)'::regprocedure),
  'record_purchase is security definer with an empty search_path'
);
select is(
  (select prorettype::regtype from pg_proc where oid = 'app.record_purchase(uuid, uuid, int)'::regprocedure),
  'app.ledger_result'::regtype,
  'record_purchase returns app.ledger_result'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-9000-000000000002","role":"authenticated"}', true);

-- Points rounded down with the ratio in force (criterion 1).
select results_eq(
  $$select (r.movement).kind, (r.movement).customer_id, (r.movement).amount_cents, (r.movement).points,
      (r.movement).cents_per_point, (r.movement).operator_name, (r.movement).operation_id, r.balance
    from app.record_purchase('00000000-0000-4000-9600-000000000001',
      '00000000-0000-4000-9100-000000000003', 1250) r$$,
  $$values ('purchase'::text, '00000000-0000-4000-9100-000000000003'::uuid, 1250, 12, 100,
      'Operatore Movimenti'::text, '00000000-0000-4000-9600-000000000001'::uuid, 12)$$,
  '12,50 € at 100 cents per point is a purchase of 12 points by the acting operator, balance 12'
);
select results_eq(
  $$select (r.movement).points, r.balance
    from app.record_purchase('00000000-0000-4000-9600-000000000002',
      '00000000-0000-4000-9100-000000000003', 199) r$$,
  $$values (1, 13)$$,
  '1,99 € is 1 point (rounded down)'
);
select results_eq(
  $$select (r.movement).amount_cents, (r.movement).points, r.balance
    from app.record_purchase('00000000-0000-4000-9600-000000000003',
      '00000000-0000-4000-9100-000000000003', 99) r$$,
  $$values (99, 0, 13)$$,
  '0,99 € is 0 points and is still recorded'
);
select is(
  (select count(*) from app.movements where customer_id = '00000000-0000-4000-9100-000000000003'),
  3::bigint,
  'the three purchases are recorded, the one worth 0 points included'
);
select is(
  (select created_at from app.movements where operation_id = '00000000-0000-4000-9600-000000000001'),
  now(),
  'the purchase is dated by the server'
);

-- The admin changes the ratio to 250 cents per point.
reset role;
update app.settings set cents_per_point = 250;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-9000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$select (r.movement).points, (r.movement).cents_per_point, r.balance
    from app.record_purchase('00000000-0000-4000-9600-000000000004',
      '00000000-0000-4000-9100-000000000003', 1250) r$$,
  $$values (5, 250, 18)$$,
  'with 250 cents per point 12,50 € is 5 points and the movement saves 250 (criterion 1)'
);

-- Back to 100: the history keeps the ratio each purchase was recorded with.
reset role;
update app.settings set cents_per_point = 100;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-9000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$select amount_cents, points, cents_per_point from app.movements
    where operation_id in ('00000000-0000-4000-9600-000000000001', '00000000-0000-4000-9600-000000000004')
    order by points desc$$,
  $$values (1250, 12, 100), (1250, 5, 250)$$,
  'changing the settings later does not alter the history'
);
select is(
  (select sum(points)::int from app.movements
   where customer_id = '00000000-0000-4000-9100-000000000003'),
  18,
  'the balance is still the sum of the recorded points'
);

-- Idempotency (criterion 4): the same operation_id returns the first movement.
select is(
  (select (r.movement).id from app.record_purchase('00000000-0000-4000-9600-000000000001',
     '00000000-0000-4000-9100-000000000003', 1250) r),
  (select id from app.movements where operation_id = '00000000-0000-4000-9600-000000000001'),
  'a resent purchase returns the movement of the first one'
);
select results_eq(
  $$select (r.movement).points, (r.movement).cents_per_point, r.balance
    from app.record_purchase('00000000-0000-4000-9600-000000000004',
      '00000000-0000-4000-9100-000000000003', 1250) r$$,
  $$values (5, 250, 18)$$,
  'a resent purchase keeps the ratio of the first one and returns the current balance'
);
select is(
  (select count(*) from app.movements where customer_id = '00000000-0000-4000-9100-000000000003'),
  4::bigint,
  'resending records nothing new'
);
select throws_ok(
  $$select app.record_purchase('00000000-0000-4000-9600-000000000001',
      '00000000-0000-4000-9100-000000000003', 1300)$$,
  'EC007',
  null,
  'the same operation_id with another amount is a conflict'
);
select throws_ok(
  $$select app.record_purchase('00000000-0000-4000-9600-000000000001',
      '00000000-0000-4000-9100-000000000002', 1250)$$,
  'EC007',
  null,
  'the same operation_id with another customer is a conflict'
);
select throws_ok(
  $$select app.record_purchase('00000000-0000-4000-9500-000000000002',
      '00000000-0000-4000-9100-000000000001', 1000)$$,
  'EC007',
  null,
  'the operation_id of a redemption is a conflict for a purchase'
);

-- Invalid amounts.
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-9100-000000000003', 0)$$,
  '22023', null, 'an amount of 0 cents is invalid'
);
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-9100-000000000003', -100)$$,
  '22023', null, 'a negative amount is invalid'
);
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-9100-000000000003', null)$$,
  '22023', null, 'a null amount is invalid'
);
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-9100-000000000003', 10000000)$$,
  '22023', null, 'an amount of 10.000.000 cents is invalid'
);
select throws_ok(
  $$select app.record_purchase(null, '00000000-0000-4000-9100-000000000003', 1000)$$,
  '22023', null, 'a purchase without operation_id is invalid'
);
select results_eq(
  $$select (r.movement).amount_cents, (r.movement).points
    from app.record_purchase(gen_random_uuid(), '00000000-0000-4000-9100-000000000002', 9999999) r$$,
  $$values (9999999, 99999)$$,
  '99.999,99 € is the largest amount accepted'
);

-- Customers that cannot buy.
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-9100-0000000000ff', 1000)$$,
  'EC006', null, 'a customer that does not exist is unavailable'
);
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), null, 1000)$$,
  'EC006', null, 'a null customer is unavailable'
);
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-9100-000000000004', 1000)$$,
  'EC006', null, 'an anonymized customer is unavailable'
);

-- A signed-in user without an operator profile.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-9000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-9100-000000000003', 1000)$$,
  '42501', null, 'a user without an operator profile cannot record a purchase'
);
reset role;

set local role anon;
select throws_ok(
  $$select app.record_purchase(gen_random_uuid(), '00000000-0000-4000-9100-000000000003', 1000)$$,
  '42501', null, 'anon cannot record a purchase'
);
reset role;

select is(
  (select count(*) from app.movements where customer_id = '00000000-0000-4000-9100-000000000003'),
  4::bigint,
  'the rejected purchases recorded nothing'
);

select * from finish();
rollback;
