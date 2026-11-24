-- Manual timing of app.list_customers (SPEC-customers-v2, criterion 6; RUNBOOK "Prova manuale di
-- customers-v2"). The blocking check is the plan in supabase/tests/customers_v2_plan.test.sql; this
-- file only measures the time, by hand, against the broad limit of 500 ms per call.
--
-- LOCAL stack only (psql inside the database container, as e2e/db.ts does):
--   docker exec -i supabase_db_enjoy-card-app psql -U postgres -d postgres \
--     < scripts/measure-list-customers.sql
-- It creates 1 000 fake customers and 20 000 fake movements (the data of the plan test) in one
-- transaction, calls the first page, a middle page and a search as an admin, prints each time
-- in milliseconds and rolls everything back. Fake data only: invented names, @example.com.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-a990-000000000001', 'misura.admin@example.com');
select private.add_operator('misura.admin@example.com', 'Admin Misura', 'admin');

select set_config('measure.t0', '2026-11-20 10:15:00.123456+01', true);

insert into app.customers
  (name, email, privacy_consent_at, created_by, create_operation_id, created_at, anonymized_at)
select
  case when i % 50 = 0 then 'Anonimo Misura ' || lpad(i::text, 4, '0')
       else 'Cliente Misura ' || lpad(i::text, 4, '0') end,
  case when i % 2 = 0 and i % 50 <> 0 then 'misura' || lpad(i::text, 4, '0') || '@example.com' end,
  now(),
  (select id from app.operators where name = 'Admin Misura'),
  gen_random_uuid(),
  current_setting('measure.t0')::timestamptz - i * interval '7 hours',
  case when i % 50 = 0 then current_setting('measure.t0')::timestamptz end
from generate_series(1, 1000) as i;

create temporary table measure_active on commit drop as
select row_number() over (order by c.created_at desc) - 1 as n, c.id
from app.customers c
where c.name like '% Misura %' and right(c.name, 1) <> '0';

insert into app.movements
  (operation_id, customer_id, kind, amount_cents, points, cents_per_point, description,
   operator_id, created_at)
select gen_random_uuid(), a.id,
  case when m % 10 = 0 then 'redemption' else 'purchase' end,
  case when m % 10 = 0 then null else 1000 end,
  case when m % 10 = 0 then -5 else 10 end,
  case when m % 10 = 0 then null else 100 end,
  case when m % 10 = 0 then 'Premio di prova' end,
  (select id from app.operators where name = 'Admin Misura'),
  current_setting('measure.t0')::timestamptz - m * interval '13 minutes'
from generate_series(1, 20000) as m
join measure_active a on a.n = m % 900;

analyze app.customers;
analyze app.movements;

-- The middle page starts after the 500th listed customer.
select set_config('measure.middle', (
  select json_build_object('activity', c.last_activity_at, 'created', c.created_at, 'id', c.id)::text
  from app.customers c
  where c.anonymized_at is null
  order by c.has_activity desc, c.sort_at desc, c.id desc
  offset 499 limit 1
), true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a990-000000000001","role":"authenticated"}', true);

-- Each call runs 5 times; the slowest one is printed with the number of rows of the page.
do $$
declare
  v_middle json := current_setting('measure.middle')::json;
  v_start timestamptz;
  v_rows int;
  v_worst numeric;
  v_case record;
begin
  for v_case in
    select * from (values
      ('prima pagina', null::text, null::timestamptz, null::timestamptz, null::uuid),
      ('pagina centrale', null, (v_middle ->> 'activity')::timestamptz,
        (v_middle ->> 'created')::timestamptz, (v_middle ->> 'id')::uuid),
      ('ricerca «misura 05»', 'misura 05', null, null, null)
    ) as t(label, query, after_activity, after_created, after_id)
  loop
    v_worst := 0;
    for i in 1..5 loop
      v_start := clock_timestamp();
      select count(*) into v_rows
      from app.list_customers(v_case.query, v_case.after_activity, v_case.after_created,
        v_case.after_id, 20);
      v_worst := greatest(v_worst,
        extract(epoch from clock_timestamp() - v_start) * 1000);
    end loop;
    raise notice '% : % righe, % ms (la più lenta di 5)', v_case.label, v_rows, round(v_worst, 1);
  end loop;
end;
$$;

reset role;
rollback;
