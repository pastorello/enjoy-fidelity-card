-- export: app.export_customers and app.export_movements, the admin-only CSV sources
-- of the customers and movements files (SPEC-export.md, "Modello dati e regole di
-- accesso"). Fake data only: invented names, @example.com emails and uids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-e000-000000000001', 'export.admin@example.com'),
  ('00000000-0000-4000-e000-000000000002', 'export.operator@example.com'),
  ('00000000-0000-4000-e000-000000000003', 'export.nobody@example.com'),
  ('00000000-0000-4000-e000-000000000004', 'export.gone@example.com');
select private.add_operator('export.admin@example.com', 'Admin Esporta', 'admin');
select private.add_operator('export.operator@example.com', 'Operatore Esporta', 'operator');
select private.add_operator('export.gone@example.com', 'Admin Scollegato', 'admin');
-- Removing the Auth user unlinks the profile (user_id null): the old session's
-- uid no longer belongs to any operator.
delete from auth.users where id = '00000000-0000-4000-e000-000000000004';

-- Fake customers, with ids at the very end of the uuid order so the pagination
-- checks below can start right before them:
--   …0001 Elio:    phone, notes, active card, purchase 12 + redemption -5 + its correction → 12
--   …0002 Fede:    no movements → 0
--   …0003 Anonimo: phone, notes, card, purchase 3, then anonymized with the RPC → 3
--   …0004 Grezzo:  anonymized_at set by hand on a row that still holds personal data
--                  and an active card: the function nulls them whatever the row holds
insert into app.customers
  (id, name, phone, notes, privacy_consent_at, created_by, create_operation_id, anonymized_at)
select fake.id, fake.name, fake.phone, fake.notes, timestamptz '2026-07-01 10:05:00+00',
  (select id from app.operators where name = 'Operatore Esporta'), gen_random_uuid(), fake.anonymized_at
from (values
  ('ffffffff-ffff-4fff-8fff-000000000001'::uuid, 'Elio Esporta', '+393330001111', 'Nota di prova',
   null::timestamptz),
  ('ffffffff-ffff-4fff-8fff-000000000002'::uuid, 'Fede Esporta', null, null, null),
  ('ffffffff-ffff-4fff-8fff-000000000003'::uuid, 'Anonimo Esporta', '+393330002222', 'Da cancellare',
   null),
  ('ffffffff-ffff-4fff-8fff-000000000004'::uuid, 'Grezzo Esporta', '+393330003333', 'Ancora qui',
   now())
) as fake (id, name, phone, notes, anonymized_at);

insert into app.cards (uid, customer_id, associated_by)
select fake.uid, fake.customer_id::uuid, (select id from app.operators where name = 'Operatore Esporta')
from (values
  ('04E0000000E001', 'ffffffff-ffff-4fff-8fff-000000000001'),
  ('04E0000000E003', 'ffffffff-ffff-4fff-8fff-000000000003'),
  ('04E0000000E004', 'ffffffff-ffff-4fff-8fff-000000000004')
) as fake (uid, customer_id);

insert into app.movements
  (id, operation_id, customer_id, kind, amount_cents, points, cents_per_point, description,
   operator_id, corrects_movement_id)
select m.id::uuid, gen_random_uuid(), m.customer_id::uuid, m.kind, m.amount_cents, m.points,
  m.cents_per_point, m.description, (select id from app.operators where name = 'Operatore Esporta'),
  m.corrects::uuid
from (values
  ('00000000-0000-4000-e300-000000000001', 'ffffffff-ffff-4fff-8fff-000000000001', 'purchase',
   1250, 12, 100, null, null),
  ('00000000-0000-4000-e300-000000000002', 'ffffffff-ffff-4fff-8fff-000000000001', 'redemption',
   null, -5, null, 'Caffè di prova', null),
  ('00000000-0000-4000-e300-000000000003', 'ffffffff-ffff-4fff-8fff-000000000001', 'correction',
   null, 5, null, null, '00000000-0000-4000-e300-000000000002'),
  ('00000000-0000-4000-e300-000000000004', 'ffffffff-ffff-4fff-8fff-000000000003', 'purchase',
   300, 3, 100, null, null)
) as m (id, customer_id, kind, amount_cents, points, cents_per_point, description, corrects);

-- Pages through every customer with the given page size, as the client does
-- (until a page shorter than the limit), and returns all the ids it received.
-- Lives only inside this rolled-back transaction.
create function public.export_test_all_customer_ids(p_limit int)
returns uuid[]
language plpgsql
as $$
declare
  v_ids uuid[] := '{}';
  v_page uuid[];
  v_after uuid := null;
begin
  loop
    select coalesce(array_agg(e.id order by e.id), '{}') into v_page
    from app.export_customers(v_after, p_limit) e;
    v_ids := v_ids || v_page;
    exit when cardinality(v_page) < p_limit;
    v_after := v_page[cardinality(v_page)];
  end loop;
  return v_ids;
end;
$$;
grant execute on function public.export_test_all_customer_ids(int) to authenticated;

-- The same for the movements, with the (created_at, id) cursor of the last row.
create function public.export_test_all_movement_ids(p_limit int)
returns uuid[]
language plpgsql
as $$
declare
  v_ids uuid[] := '{}';
  v_count int;
  v_after_created_at timestamptz := null;
  v_after_id uuid := null;
  v_row record;
begin
  loop
    v_count := 0;
    for v_row in
      select e.id, e.created_at from app.export_movements(v_after_created_at, v_after_id, p_limit) e
    loop
      v_ids := v_ids || v_row.id;
      v_count := v_count + 1;
      v_after_created_at := v_row.created_at;
      v_after_id := v_row.id;
    end loop;
    exit when v_count < p_limit;
  end loop;
  return v_ids;
end;
$$;
grant execute on function public.export_test_all_movement_ids(int) to authenticated;

-- Catalogue ---------------------------------------------------------------------------
select is(
  pg_get_function_result('app.export_customers(uuid, int)'::regprocedure),
  'TABLE(id uuid, name text, phone text, active_card_uid text, balance_points integer, '
    'privacy_consent_at timestamp with time zone, notes text, created_at timestamp with time zone, '
    'created_by_name text, anonymized_at timestamp with time zone)',
  'export_customers returns the columns of the spec, in order'
);
select is(
  (select provolatile from pg_proc where oid = 'app.export_customers(uuid, int)'::regprocedure),
  's',
  'export_customers is stable: it writes nothing'
);
select ok(
  (select prosecdef from pg_proc where oid = 'app.export_customers(uuid, int)'::regprocedure),
  'export_customers is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'app.export_customers(uuid, int)'::regprocedure),
  array['search_path=""'],
  'export_customers pins an empty search_path'
);
select ok(
  not has_function_privilege('anon', 'app.export_customers(uuid, int)', 'execute'),
  'anon cannot execute export_customers'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'app.export_customers(uuid, int)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no execute on export_customers'
);
select ok(
  has_function_privilege('authenticated', 'app.export_customers(uuid, int)', 'execute'),
  'authenticated can execute export_customers (the role is checked inside)'
);
select is(
  pg_get_function_result('app.export_movements(timestamptz, uuid, int)'::regprocedure),
  'TABLE(id uuid, created_at timestamp with time zone, customer_id uuid, customer_name text, '
    'kind text, amount_cents integer, points integer, cents_per_point integer, description text, '
    'operator_name text, corrects_movement_id uuid, corrected_by_movement_id uuid)',
  'export_movements returns the columns of the spec, in order'
);
select is(
  (select provolatile from pg_proc
   where oid = 'app.export_movements(timestamptz, uuid, int)'::regprocedure),
  's',
  'export_movements is stable: it writes nothing'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'app.export_movements(timestamptz, uuid, int)'::regprocedure),
  'export_movements is security definer'
);
select is(
  (select proconfig from pg_proc
   where oid = 'app.export_movements(timestamptz, uuid, int)'::regprocedure),
  array['search_path=""'],
  'export_movements pins an empty search_path'
);
select ok(
  not has_function_privilege('anon', 'app.export_movements(timestamptz, uuid, int)', 'execute'),
  'anon cannot execute export_movements'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'app.export_movements(timestamptz, uuid, int)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no execute on export_movements'
);
select ok(
  has_function_privilege('authenticated', 'app.export_movements(timestamptz, uuid, int)', 'execute'),
  'authenticated can execute export_movements (the role is checked inside)'
);

-- Anonymization through the RPC of customers, as an admin -------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select app.anonymize_customer('ffffffff-ffff-4fff-8fff-000000000003')$$,
  'the admin anonymizes a fake customer'
);

-- Admin --------------------------------------------------------------------------------
select results_eq(
  $$select id, name, phone, active_card_uid, balance_points, privacy_consent_at, notes,
           created_by_name, anonymized_at is not null
    from app.export_customers('ffffffff-ffff-4fff-8fff-000000000000', 1000)
    order by id$$,
  $$values
    ('ffffffff-ffff-4fff-8fff-000000000001'::uuid, 'Elio Esporta'::text, '+393330001111'::text,
     '04E0000000E001'::text, 12, timestamptz '2026-07-01 10:05:00+00', 'Nota di prova'::text,
     'Operatore Esporta'::text, false),
    ('ffffffff-ffff-4fff-8fff-000000000002'::uuid, 'Fede Esporta', null, null, 0,
     timestamptz '2026-07-01 10:05:00+00', null, 'Operatore Esporta', false),
    ('ffffffff-ffff-4fff-8fff-000000000003'::uuid, null, null, null, 3,
     timestamptz '2026-07-01 10:05:00+00', null, 'Operatore Esporta', true),
    ('ffffffff-ffff-4fff-8fff-000000000004'::uuid, null, null, null, 0,
     timestamptz '2026-07-01 10:05:00+00', null, 'Operatore Esporta', true)$$,
  'the admin receives the fake customers with card, balance and creator; anonymized ones without personal data'
);
select is(
  (select created_at from app.export_customers('ffffffff-ffff-4fff-8fff-000000000000', 1)),
  (select created_at from app.customers where id = 'ffffffff-ffff-4fff-8fff-000000000001'),
  'created_at is the creation time of the customer'
);
select is(
  (select balance_points from app.export_customers('ffffffff-ffff-4fff-8fff-000000000000', 1)),
  12,
  'balance_points sums every movement, the cancelled redemption and its correction included'
);
select is(
  (select balance_points from app.export_customers('ffffffff-ffff-4fff-8fff-000000000001', 1)),
  0,
  'balance_points is 0 for a customer without movements'
);
select is(
  (select row(name, phone, notes, active_card_uid)::text
   from app.export_customers('ffffffff-ffff-4fff-8fff-000000000002', 1)),
  '(,,,)',
  'the anonymized customer comes back with name, phone, notes and card null'
);
select is(
  (select balance_points from app.export_customers('ffffffff-ffff-4fff-8fff-000000000002', 1)),
  3,
  'the anonymized customer keeps the balance of their movements'
);
select is(
  (select anonymized_at from app.export_customers('ffffffff-ffff-4fff-8fff-000000000002', 1)),
  (select anonymized_at from app.customers where id = 'ffffffff-ffff-4fff-8fff-000000000003'),
  'anonymized_at is the anonymization time'
);
select is(
  (select row(name, phone, notes, active_card_uid)::text
   from app.export_customers('ffffffff-ffff-4fff-8fff-000000000003', 1)),
  '(,,,)',
  'an anonymized row still holding personal data and an active card comes back nulled'
);
select ok(
  not exists (
    select 1
    from app.export_customers(null, 1000) e
    where e.anonymized_at is not null
      and (e.name is not null or e.phone is not null or e.notes is not null
           or e.active_card_uid is not null)
  ),
  'no anonymized customer of the whole export carries personal data'
);

-- Keyset pagination ----------------------------------------------------------------------
select results_eq(
  $$select id from app.export_customers('ffffffff-ffff-4fff-8fff-000000000000', 2)$$,
  $$values ('ffffffff-ffff-4fff-8fff-000000000001'::uuid), ('ffffffff-ffff-4fff-8fff-000000000002'::uuid)$$,
  'the first page of 2 holds the first two ids after the cursor, in id order'
);
select results_eq(
  $$select id from app.export_customers('ffffffff-ffff-4fff-8fff-000000000002', 2)$$,
  $$values ('ffffffff-ffff-4fff-8fff-000000000003'::uuid), ('ffffffff-ffff-4fff-8fff-000000000004'::uuid)$$,
  'the second page continues right after the last id of the first'
);
select is(
  (select count(*)::int from app.export_customers('ffffffff-ffff-4fff-8fff-000000000004', 2)),
  0,
  'after the last id the page is empty'
);
select is(
  (select array_agg(id order by id) from app.customers),
  public.export_test_all_customer_ids(2),
  'pages of 2 from the start cover every customer once, without duplicates, in id order'
);
select is(
  (select count(*)::int from app.export_customers()),
  least((select count(*)::int from app.customers), 1000),
  'without arguments the export starts from the beginning with pages of 1000'
);
select throws_ok(
  $$select * from app.export_customers(null, 0)$$, '22023', null, 'p_limit 0 is refused'
);
select throws_ok(
  $$select * from app.export_customers(null, 1001)$$, '22023', null, 'p_limit 1001 is refused'
);
select throws_ok(
  $$select * from app.export_customers(null, null)$$, '22023', null, 'p_limit null is refused'
);
select lives_ok(
  $$select * from app.export_customers(null, 1)$$, 'p_limit 1 is accepted'
);

-- Movements, as the admin ---------------------------------------------------------------
-- More fixtures, written as the table owner and then back to the admin session:
--   * Elio is renamed: the export shows the current name, not the one at the movement time;
--   * …e300-0005 is an older catalogue redemption of Fede whose description is null, to
--     reach the reward-name fallback. The redemption check forbids a null description
--     today, so it is dropped inside this rolled-back transaction only.
reset role;
update app.customers set name = 'Elio Rinominato' where id = 'ffffffff-ffff-4fff-8fff-000000000001';
insert into app.rewards (id, name, points, created_by, updated_by)
select '00000000-0000-4000-e400-000000000001', 'Premio di prova', 4, o.id, o.id
from app.operators o where o.name = 'Admin Esporta';
alter table app.movements drop constraint movements_redemption_check;
insert into app.movements
  (id, operation_id, customer_id, kind, points, reward_id, description, operator_id, created_at)
select '00000000-0000-4000-e300-000000000005', gen_random_uuid(),
  'ffffffff-ffff-4fff-8fff-000000000002', 'redemption', -4, '00000000-0000-4000-e400-000000000001',
  null, o.id, timestamptz '2026-07-01 10:05:00+00'
from app.operators o where o.name = 'Admin Esporta';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$select id, customer_id, customer_name, kind, amount_cents, points, cents_per_point, description,
           operator_name, corrects_movement_id, corrected_by_movement_id
    from app.export_movements()
    where id::text like '00000000-0000-4000-e300-%'$$,
  $$values
    ('00000000-0000-4000-e300-000000000005'::uuid, 'ffffffff-ffff-4fff-8fff-000000000002'::uuid,
     'Fede Esporta'::text, 'redemption'::text, null::int, -4, null::int, 'Premio di prova'::text,
     'Admin Esporta'::text, null::uuid, null::uuid),
    ('00000000-0000-4000-e300-000000000001', 'ffffffff-ffff-4fff-8fff-000000000001',
     'Elio Rinominato', 'purchase', 1250, 12, 100, null, 'Operatore Esporta', null, null),
    ('00000000-0000-4000-e300-000000000002', 'ffffffff-ffff-4fff-8fff-000000000001',
     'Elio Rinominato', 'redemption', null, -5, null, 'Caffè di prova', 'Operatore Esporta', null,
     '00000000-0000-4000-e300-000000000003'),
    ('00000000-0000-4000-e300-000000000003', 'ffffffff-ffff-4fff-8fff-000000000001',
     'Elio Rinominato', 'correction', null, 5, null, null, 'Operatore Esporta',
     '00000000-0000-4000-e300-000000000002', null),
    ('00000000-0000-4000-e300-000000000004', 'ffffffff-ffff-4fff-8fff-000000000003',
     null, 'purchase', 300, 3, 100, null, 'Operatore Esporta', null, null)$$,
  'the admin receives every movement in (created_at, id) order with kind, amounts, description, operator and correction links'
);
select is(
  (select row(amount_cents, points, cents_per_point)::text from app.export_movements()
   where id = '00000000-0000-4000-e300-000000000001'),
  '(1250,12,100)',
  'a purchase carries amount_cents, points and the cents_per_point in force'
);
select is(
  (select description from app.export_movements()
   where id = '00000000-0000-4000-e300-000000000002'),
  'Caffè di prova',
  'a redemption carries its own description'
);
select is(
  (select description from app.export_movements()
   where id = '00000000-0000-4000-e300-000000000005'),
  'Premio di prova',
  'a redemption without a description falls back to the reward name'
);
select is(
  (select created_at from app.export_movements()
   where id = '00000000-0000-4000-e300-000000000005'),
  timestamptz '2026-07-01 10:05:00+00',
  'created_at is the time of the movement'
);
select ok(
  not exists (
    select 1
    from app.export_movements() e
    left join app.export_movements() c on c.id = e.corrected_by_movement_id
    where (e.corrected_by_movement_id is not null
           and c.corrects_movement_id is distinct from e.id)
       or (e.corrects_movement_id is not null
           and (select corrected_by_movement_id from app.export_movements() t
                where t.id = e.corrects_movement_id) is distinct from e.id)
  ),
  'corrected_by_movement_id and corrects_movement_id point at each other'
);
select is(
  (select customer_name from app.export_movements()
   where id = '00000000-0000-4000-e300-000000000004'),
  null,
  'the movement of an anonymized customer is exported with customer_name null'
);
select is(
  (select points from app.export_movements()
   where id = '00000000-0000-4000-e300-000000000004'),
  3,
  'the movement of an anonymized customer keeps its points'
);
select ok(
  not exists (
    select 1
    from app.export_movements() e
    join app.customers c on c.id = e.customer_id
    where c.anonymized_at is not null and e.customer_name is not null
  ),
  'no movement of an anonymized customer carries the customer name'
);

-- Movements keyset pagination ------------------------------------------------------------
-- …0005 is older; …0001 to …0004 share the created_at of this transaction (now()), so
-- pages of 2 cut through equal created_at values. The local database may already hold
-- movements left by integration and E2E runs (older than now(), maybe older than …0005),
-- so the first page is checked against the table's own order, not against fixture ids.
select results_eq(
  $$select id from app.export_movements(null, null, 2)$$,
  $$select id from app.movements order by created_at, id limit 2$$,
  'the first page of 2 holds the two oldest movements'
);
select results_eq(
  $$select id from app.export_movements(now(), '00000000-0000-4000-e300-000000000001', 2)$$,
  $$values ('00000000-0000-4000-e300-000000000002'::uuid), ('00000000-0000-4000-e300-000000000003'::uuid)$$,
  'the second page continues after the cursor among movements with the same created_at'
);
select results_eq(
  $$select id from app.export_movements(now(), '00000000-0000-4000-e300-000000000003', 2)$$,
  $$values ('00000000-0000-4000-e300-000000000004'::uuid)$$,
  'the last page is shorter than the limit'
);
select is(
  (select array_agg(id order by created_at, id) from app.movements),
  public.export_test_all_movement_ids(2),
  'pages of 2 from the start cover every movement once, without duplicates, in (created_at, id) order'
);
select is(
  (select count(*)::int from app.export_movements()),
  least((select count(*)::int from app.movements), 1000),
  'without arguments the movements export starts from the beginning with pages of 1000'
);
select throws_ok(
  $$select * from app.export_movements(null, null, 0)$$, '22023', null,
  'export_movements refuses p_limit 0'
);
select throws_ok(
  $$select * from app.export_movements(null, null, 1001)$$, '22023', null,
  'export_movements refuses p_limit 1001'
);
select throws_ok(
  $$select * from app.export_movements(null, null, null)$$, '22023', null,
  'export_movements refuses p_limit null'
);
select throws_ok(
  $$select * from app.export_movements(now(), null, 2)$$, '22023', null,
  'a cursor with created_at but no id is refused'
);
select throws_ok(
  $$select * from app.export_movements(null, '00000000-0000-4000-e300-000000000001', 2)$$, '22023',
  null, 'a cursor with id but no created_at is refused'
);
select lives_ok(
  $$select * from app.export_movements(null, null, 1)$$, 'export_movements accepts p_limit 1'
);

-- Operator -------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select * from app.export_customers()$$, '42501', null, 'an operator cannot export customers'
);
select throws_ok(
  $$select * from app.export_customers(null, 0)$$, '42501', null,
  'the role is checked before the arguments'
);
select throws_ok(
  $$select * from app.export_movements()$$, '42501', null, 'an operator cannot export movements'
);
select throws_ok(
  $$select * from app.export_movements(now(), null, 0)$$, '42501', null,
  'export_movements checks the role before the arguments'
);

-- Signed-in user without a profile ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select * from app.export_customers()$$, '42501', null,
  'a user without an operator profile cannot export customers'
);
select throws_ok(
  $$select * from app.export_movements()$$, '42501', null,
  'a user without an operator profile cannot export movements'
);

-- Unlinked admin (Auth user removed, old session) -------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$select * from app.export_customers()$$, '42501', null,
  'an unlinked admin profile cannot export customers'
);
select throws_ok(
  $$select * from app.export_movements()$$, '42501', null,
  'an unlinked admin profile cannot export movements'
);
reset role;

-- anon -------------------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select * from app.export_customers()$$, '42501', null, 'anon cannot call export_customers'
);
select throws_ok(
  $$select * from app.export_movements()$$, '42501', null, 'anon cannot call export_movements'
);
reset role;

select is(
  (select count(*)::int from app.movements where customer_id::text like 'ffffffff-ffff-4fff-8fff-%'),
  5,
  'exporting wrote no movement'
);

select * from finish();
rollback;
