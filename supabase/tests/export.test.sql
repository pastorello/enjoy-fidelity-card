-- export: app.export_customers, the admin-only CSV source of the customers file
-- (SPEC-export.md, "Modello dati e regole di accesso"). Fake data only: invented
-- names, @example.com emails and uids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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

-- Operator -------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select * from app.export_customers()$$, '42501', null, 'an operator cannot export customers'
);
select throws_ok(
  $$select * from app.export_customers(null, 0)$$, '42501', null,
  'the role is checked before the arguments'
);

-- Signed-in user without a profile ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select * from app.export_customers()$$, '42501', null,
  'a user without an operator profile cannot export customers'
);

-- Unlinked admin (Auth user removed, old session) -------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$select * from app.export_customers()$$, '42501', null,
  'an unlinked admin profile cannot export customers'
);
reset role;

-- anon -------------------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select * from app.export_customers()$$, '42501', null, 'anon cannot call export_customers'
);
reset role;

select is(
  (select count(*)::int from app.movements where customer_id::text like 'ffffffff-ffff-4fff-8fff-%'),
  4,
  'exporting wrote no movement'
);

select * from finish();
rollback;
