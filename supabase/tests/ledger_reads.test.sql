-- ledger: the real balance in the customer reads of customers (search_customers,
-- get_customer, customers_served_today) and in the public page of cards
-- (card_points). SPEC-ledger.md, "Saldo nelle letture di customers" and criterion
-- 10. Fake data only: invented names, @example.com emails and uids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a700-000000000001', 'reads.admin@example.com'),
  ('00000000-0000-4000-a700-000000000002', 'reads.operator@example.com');
select private.add_operator('reads.admin@example.com', 'Admin Letture', 'admin');
select private.add_operator('reads.operator@example.com', 'Operatore Letture', 'operator');

-- The start of today in Europe/Rome, fixed for the whole transaction (now() is
-- the transaction start), whatever the time zone of the session.
select set_config(
  'reads_test.today',
  ((date_trunc('day', now() at time zone 'Europe/Rome')) at time zone 'Europe/Rome')::text,
  true
);

-- Fake customers:
--   Rita: purchase 23:59 yesterday, redemption 00:01 today      → balance 2, served
--   Sara: purchase, redemption, correction of it, all today     → balance 20, served at the redemption
--   Tino: purchase 23:59 yesterday only                         → balance 8, not served today
--   Ugo:  purchase yesterday, its correction today              → balance 0, not served today
--   Vera: no movements                                          → balance 0
--   Zeno: purchase today, then cancelled                        → balance 0, served at the purchase
--   Anonimo: purchase today, then anonymized                    → balance 3, never in the list
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
select fake.id, fake.name, now(), (select id from app.operators where name = 'Admin Letture'), gen_random_uuid()
from (values
  ('00000000-0000-4000-a100-000000000001'::uuid, 'Rita Letture'),
  ('00000000-0000-4000-a100-000000000002'::uuid, 'Sara Letture'),
  ('00000000-0000-4000-a100-000000000003'::uuid, 'Tino Letture'),
  ('00000000-0000-4000-a100-000000000004'::uuid, 'Ugo Letture'),
  ('00000000-0000-4000-a100-000000000005'::uuid, 'Vera Letture'),
  ('00000000-0000-4000-a100-000000000006'::uuid, 'Zeno Letture'),
  ('00000000-0000-4000-a100-000000000007'::uuid, 'Anonimo Letture')
) as fake (id, name);

update app.customers set phone = '+393330007711' where id = '00000000-0000-4000-a100-000000000001';

-- 52 fillers with one purchase each between 00:00:00.5 and 00:00:26 today, all
-- before the customers above: only the 50 most recent customers are listed.
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
select ('00000000-0000-4000-a200-' || lpad(n::text, 12, '0'))::uuid, 'Riempitivo ' || lpad(n::text, 2, '0'),
  now(), (select id from app.operators where name = 'Admin Letture'), gen_random_uuid()
from generate_series(1, 52) as n;

-- Everyone else (the seed, rows left by other runs) is set aside in this
-- rolled-back transaction, so the list holds only the customers above.
update app.customers set anonymized_at = now()
where anonymized_at is null
  and id::text not like '00000000-0000-4000-a100-%'
  and id::text not like '00000000-0000-4000-a200-%';

insert into app.movements
  (id, operation_id, customer_id, kind, amount_cents, points, cents_per_point, reward_id,
   description, operator_id, created_at, corrects_movement_id)
select m.id::uuid, gen_random_uuid(), m.customer_id::uuid, m.kind, m.amount_cents, m.points,
  m.cents_per_point, null, m.description,
  (select id from app.operators where name = 'Operatore Letture'),
  current_setting('reads_test.today')::timestamptz + m.offset_from_today, m.corrects::uuid
from (values
  -- Rita
  ('00000000-0000-4000-a300-000000000001', '00000000-0000-4000-a100-000000000001', 'purchase',
   1250, 12, 100, null, interval '-1 minute', null),
  ('00000000-0000-4000-a300-000000000002', '00000000-0000-4000-a100-000000000001', 'redemption',
   null, -10, null, 'Caffè di prova', interval '1 minute', null),
  -- Sara
  ('00000000-0000-4000-a300-000000000003', '00000000-0000-4000-a100-000000000002', 'purchase',
   2000, 20, 100, null, interval '2 minutes', null),
  ('00000000-0000-4000-a300-000000000004', '00000000-0000-4000-a100-000000000002', 'redemption',
   null, -5, null, 'Cornetto di prova', interval '3 minutes', null),
  ('00000000-0000-4000-a300-000000000005', '00000000-0000-4000-a100-000000000002', 'correction',
   null, 5, null, null, interval '4 minutes', '00000000-0000-4000-a300-000000000004'),
  -- Tino
  ('00000000-0000-4000-a300-000000000006', '00000000-0000-4000-a100-000000000003', 'purchase',
   800, 8, 100, null, interval '-1 minute', null),
  -- Ugo
  ('00000000-0000-4000-a300-000000000007', '00000000-0000-4000-a100-000000000004', 'purchase',
   700, 7, 100, null, interval '-2 minutes', null),
  ('00000000-0000-4000-a300-000000000008', '00000000-0000-4000-a100-000000000004', 'correction',
   null, -7, null, null, interval '5 minutes', '00000000-0000-4000-a300-000000000007'),
  -- Zeno
  ('00000000-0000-4000-a300-000000000009', '00000000-0000-4000-a100-000000000006', 'purchase',
   400, 4, 100, null, interval '7 minutes', null),
  ('00000000-0000-4000-a300-000000000010', '00000000-0000-4000-a100-000000000006', 'correction',
   null, -4, null, null, interval '8 minutes', '00000000-0000-4000-a300-000000000009'),
  -- Anonimo, the latest of all
  ('00000000-0000-4000-a300-000000000011', '00000000-0000-4000-a100-000000000007', 'purchase',
   300, 3, 100, null, interval '9 minutes', null)
) as m (id, customer_id, kind, amount_cents, points, cents_per_point, description, offset_from_today,
        corrects);

insert into app.movements
  (operation_id, customer_id, kind, amount_cents, points, cents_per_point, operator_id, created_at)
select gen_random_uuid(), ('00000000-0000-4000-a200-' || lpad(n::text, 12, '0'))::uuid, 'purchase',
  100, 1, 100, (select id from app.operators where name = 'Operatore Letture'),
  current_setting('reads_test.today')::timestamptz + n * interval '500 milliseconds'
from generate_series(1, 52) as n;

-- A card with a confirmed link for Rita and for Sara (as the operator).
insert into app.cards (id, uid, customer_id, active, associated_by)
select fake.id, fake.uid, fake.customer_id, true, (select id from app.operators where name = 'Admin Letture')
from (values
  ('00000000-0000-4000-a400-000000000001'::uuid, '04AABB00000001', '00000000-0000-4000-a100-000000000001'::uuid),
  ('00000000-0000-4000-a400-000000000002'::uuid, '04AABB00000002', '00000000-0000-4000-a100-000000000002'::uuid)
) as fake (id, uid, customer_id);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a700-000000000002","role":"authenticated"}', true);
select set_config('reads_test.rita', app.issue_card_link('00000000-0000-4000-a400-000000000001'), true);
select app.confirm_card_link('00000000-0000-4000-a400-000000000001', current_setting('reads_test.rita'));
select set_config('reads_test.sara', app.issue_card_link('00000000-0000-4000-a400-000000000002'), true);
select app.confirm_card_link('00000000-0000-4000-a400-000000000002', current_setting('reads_test.sara'));

-- The admin erases Anonimo's personal data after the purchase.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a700-000000000001","role":"authenticated"}', true);
select app.anonymize_customer('00000000-0000-4000-a100-000000000007');

-- search_customers and get_customer ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a700-000000000002","role":"authenticated"}', true);

select results_eq(
  $$select name, balance, last_served_at from app.search_customers('letture')$$,
  $$values ('Rita Letture'::text, 2, current_setting('reads_test.today')::timestamptz + interval '1 minute'),
           ('Sara Letture'::text, 20, current_setting('reads_test.today')::timestamptz + interval '3 minutes'),
           ('Tino Letture'::text, 8, null::timestamptz),
           ('Ugo Letture'::text, 0, null::timestamptz),
           ('Vera Letture'::text, 0, null::timestamptz),
           ('Zeno Letture'::text, 0, current_setting('reads_test.today')::timestamptz + interval '7 minutes')$$,
  'search_customers gives the real balance and the last purchase or redemption of today'
);
select results_eq(
  $$select name, balance from app.search_customers('333 000 7711')$$,
  $$values ('Rita Letture'::text, 2)$$,
  'a search by phone gives the real balance too'
);
select results_eq(
  $$select balance, last_served_at from app.get_customer('00000000-0000-4000-a100-000000000001')$$,
  $$values (2, current_setting('reads_test.today')::timestamptz + interval '1 minute')$$,
  'get_customer: purchase yesterday minus a redemption today'
);
select results_eq(
  $$select balance, last_served_at from app.get_customer('00000000-0000-4000-a100-000000000002')$$,
  $$values (20, current_setting('reads_test.today')::timestamptz + interval '3 minutes')$$,
  'get_customer: a cancelled redemption is given back by its correction'
);
select results_eq(
  $$select balance, last_served_at from app.get_customer('00000000-0000-4000-a100-000000000003')$$,
  $$values (8, null::timestamptz)$$,
  'get_customer: a purchase at 23:59 yesterday counts in the balance, not as served today'
);
select results_eq(
  $$select balance, last_served_at from app.get_customer('00000000-0000-4000-a100-000000000004')$$,
  $$values (0, null::timestamptz)$$,
  'get_customer: a correction today of yesterday''s purchase zeroes the balance and is not a service'
);
select results_eq(
  $$select balance, last_served_at from app.get_customer('00000000-0000-4000-a100-000000000005')$$,
  $$values (0, null::timestamptz)$$,
  'get_customer: no movements, balance 0'
);
select results_eq(
  $$select balance from app.get_customer('00000000-0000-4000-a100-000000000007')$$,
  $$values (3)$$,
  'get_customer: an anonymized customer keeps the balance of the movements'
);
select is(
  pg_typeof((select balance from app.get_customer('00000000-0000-4000-a100-000000000001')))::text,
  'integer',
  'the balance is an int'
);

-- customers_served_today -----------------------------------------------------------------------
select is(
  (select count(*) from app.customers_served_today()),
  50::bigint,
  'at most 50 customers served today'
);
select results_eq(
  $$select id, name, balance, last_served_at from app.customers_served_today() limit 3$$,
  $$values ('00000000-0000-4000-a100-000000000006'::uuid, 'Zeno Letture'::text, 0,
            current_setting('reads_test.today')::timestamptz + interval '7 minutes'),
           ('00000000-0000-4000-a100-000000000002'::uuid, 'Sara Letture'::text, 20,
            current_setting('reads_test.today')::timestamptz + interval '3 minutes'),
           ('00000000-0000-4000-a100-000000000001'::uuid, 'Rita Letture'::text, 2,
            current_setting('reads_test.today')::timestamptz + interval '1 minute')$$,
  'most recent first; a cancelled purchase counts, the time is the purchase or redemption, not the correction'
);
select ok(
  not exists (select 1 from app.customers_served_today() where id = '00000000-0000-4000-a100-000000000003'),
  'a purchase at 23:59 yesterday (Rome) is not today'
);
select ok(
  exists (select 1 from app.customers_served_today()
          where id = '00000000-0000-4000-a100-000000000001'
            and last_served_at = current_setting('reads_test.today')::timestamptz + interval '1 minute'),
  'a redemption at 00:01 today (Rome) is today'
);
select ok(
  not exists (select 1 from app.customers_served_today() where id = '00000000-0000-4000-a100-000000000004'),
  'a correction alone does not make a customer served today'
);
select ok(
  not exists (select 1 from app.customers_served_today() where id = '00000000-0000-4000-a100-000000000007'),
  'anonymized customers are never listed'
);
select ok(
  not exists (select 1 from app.customers_served_today() where id = '00000000-0000-4000-a100-000000000005'),
  'a customer without movements is not listed'
);
select is(
  array(select last_served_at from app.customers_served_today()),
  array(select last_served_at from app.customers_served_today() order by last_served_at desc),
  'the list is ordered by last_served_at, most recent first'
);
select is(
  array(select name from app.customers_served_today() where name like 'Riempitivo %' order by name),
  array(select 'Riempitivo ' || lpad(n::text, 2, '0') from generate_series(6, 52) as n),
  'the limit drops the customers served earliest'
);
select results_eq(
  $$select phone, notes, anonymized_at from app.customers_served_today()
    where id = '00000000-0000-4000-a100-000000000001'$$,
  $$values ('+393330007711'::text, null::text, null::timestamptz)$$,
  'the other fields of customer_summary are the customer''s'
);
reset role;

-- card_points ------------------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(public.card_points(current_setting('reads_test.rita')), 2, 'card_points gives the real balance');
select is(
  public.card_points(current_setting('reads_test.sara')),
  20,
  'card_points counts the correction of a cancelled redemption'
);
reset role;

-- A user without a profile still gets not_operator first.
insert into auth.users (id, email) values ('00000000-0000-4000-a700-000000000003', 'reads.nobody@example.com');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a700-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select * from app.customers_served_today()$$,
  'P0001', 'not_operator', 'a user without a profile cannot list the customers served today'
);
reset role;

select * from finish();
rollback;
