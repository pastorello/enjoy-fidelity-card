-- customers-v2: the plan of the home list with many rows (SPEC-customers-v2.md, criterion 6).
-- With 1 000 fake customers and 20 000 fake movements, the first page, a middle page and a
-- search of app.list_customers read customers_home_order_idx (Index Only Scan or Index
-- Scan). This is the blocking, deterministic check; no timing assertion here (shared CI
-- runners would make it random): the time is measured by hand (RUNBOOK).
--
-- EXPLAIN cannot look inside a plpgsql function, so the file takes the `return query`
-- statement out of the deployed body of app.list_customers (pg_proc.prosrc, its variables
-- turned into parameters) and explains it planned with the parameter values, as the function
-- runs it (plan_cache_mode = force_custom_plan). Any edit to the function's query changes what
-- is explained. The same three calls are then made through app.list_customers and must return
-- the same rows, a check of the extraction itself.
--
-- Everything happens in one transaction that is rolled back: nothing stays in the
-- database. Fake data only: invented names, @example.com emails.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-4000-a900-000000000001', 'plan.admin@example.com');
select private.add_operator('plan.admin@example.com', 'Admin Piano', 'admin');

select set_config('plan_test.t0', '2026-11-20 10:15:00.123456+01', true);

-- 1 000 customers: every 10th without movements, every 50th anonymized, every other one
-- with an email; created one every 7 hours going back from t0.
insert into app.customers
  (name, email, privacy_consent_at, created_by, create_operation_id, created_at, anonymized_at)
select
  case when i % 50 = 0 then 'Anonimo Piano ' || lpad(i::text, 4, '0')
       else 'Cliente Piano ' || lpad(i::text, 4, '0') end,
  case when i % 2 = 0 and i % 50 <> 0 then 'piano' || lpad(i::text, 4, '0') || '@example.com' end,
  now(),
  (select id from app.operators where name = 'Admin Piano'),
  gen_random_uuid(),
  current_setting('plan_test.t0')::timestamptz - i * interval '7 hours',
  case when i % 50 = 0 then current_setting('plan_test.t0')::timestamptz end
from generate_series(1, 1000) as i;

-- 20 000 movements over the 900 customers with activity (every 10th one a redemption),
-- one every 13 minutes going back from t0: the trigger writes last_activity_at.
create temporary table plan_active on commit drop as
select row_number() over (order by c.created_at desc) - 1 as n, c.id
from app.customers c
where c.name like '% Piano %' and right(c.name, 1) <> '0';

insert into app.movements
  (operation_id, customer_id, kind, amount_cents, points, cents_per_point, description,
   operator_id, created_at)
select gen_random_uuid(), a.id,
  case when m % 10 = 0 then 'redemption' else 'purchase' end,
  case when m % 10 = 0 then null else 1000 end,
  case when m % 10 = 0 then -5 else 10 end,
  case when m % 10 = 0 then null else 100 end,
  case when m % 10 = 0 then 'Premio di prova' end,
  (select id from app.operators where name = 'Admin Piano'),
  current_setting('plan_test.t0')::timestamptz - m * interval '13 minutes'
from generate_series(1, 20000) as m
join plan_active a on a.n = m % 900;

analyze app.customers;
analyze app.movements;

-- The query of the deployed list_customers body: the text of its `return query` statement,
-- whitespace collapsed, its variables as parameters: $1 = v_patterns, $2 = v_email_pattern,
-- $3 = p_after_activity_at, $4 = p_after_created_at, $5 = p_after_id, $6 = p_limit.
create function pg_temp.home_query() returns text language sql stable as $f$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(
      substring(p.prosrc from '(?:\mreturn query\M)(.*?);\s*end;\s*$'),
      '\s+', ' ', 'g'),
    '\mv_patterns\M', '$1', 'g'),
    '\mv_email_pattern\M', '$2', 'g'),
    '\mp_after_activity_at\M', '$3', 'g'),
    '\mp_after_created_at\M', '$4', 'g'),
    '\mp_after_id\M', '$5', 'g'),
    '\mp_limit\M', '$6', 'g')
  from pg_proc p
  where p.oid = 'app.list_customers(text,timestamptz,timestamptz,uuid,int)'::regprocedure
$f$;

select ok(
  pg_temp.home_query() ~ '^ select .* from app\.customers c .* limit \$6 \) f order by .*$'
    and pg_temp.home_query() !~ '\m(v|p)_[a-z_]+\M',
  'the query is taken from the body of list_customers, every variable a parameter'
);
select is(
  (select count(*)::int from pg_proc
   where pronamespace = 'app'::regnamespace and proname = 'list_customers'),
  1,
  'one list_customers only: the one whose body is explained'
);

-- The text-to-pattern step of the body: one pattern per word for the name key and one
-- for the whole text in the email, from 2 characters; \, % and _ literal.
create function pg_temp.call_args(p_query text, out patterns text[], out email_pattern text)
language plpgsql as $$
declare
  v_text text := private.clean_name(left(coalesce(p_query, ''), 80));
begin
  if length(v_text) >= 2 then
    select array_agg(
      '%' || replace(replace(replace(private.customer_name_key(w), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
    into patterns
    from unnest(string_to_array(v_text, ' ')) as w;
    email_pattern :=
      '%' || replace(replace(replace(lower(v_text), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
end;
$$;

-- The scans of app.customers in the plan of one call, as "<node type> using <index>".
-- A dynamic statement is planned once with its parameter values, like the custom plans of
-- the function.
create function pg_temp.customers_scans(
  p_query text, p_after_activity_at timestamptz, p_after_created_at timestamptz,
  p_after_id uuid, p_limit int
) returns text language plpgsql as $$
declare
  v_args record := pg_temp.call_args(p_query);
  v_plan jsonb;
begin
  execute 'explain (format json) ' || pg_temp.home_query()
  into v_plan
  using v_args.patterns, v_args.email_pattern, p_after_activity_at, p_after_created_at,
    p_after_id, p_limit;
  return (
    select string_agg(node ->> 'Node Type' || coalesce(' using ' || (node ->> 'Index Name'), ''), ', ')
    from jsonb_path_query(v_plan, 'strict $.**?(@."Relation Name" == "customers")') as node
  );
end;
$$;

-- The ids of one page of the explained query, in order.
create function pg_temp.page_ids(
  p_query text, p_after_activity_at timestamptz, p_after_created_at timestamptz,
  p_after_id uuid, p_limit int
) returns uuid[] language plpgsql as $$
declare
  v_args record := pg_temp.call_args(p_query);
  v_row record;
  v_ids uuid[] := '{}';
begin
  for v_row in execute pg_temp.home_query()
    using v_args.patterns, v_args.email_pattern, p_after_activity_at, p_after_created_at,
      p_after_id, p_limit
  loop
    v_ids := v_ids || v_row.id;
  end loop;
  return v_ids;
end;
$$;

-- The middle page starts after the 500th listed customer.
select set_config('plan_test.middle', (
  select json_build_object('activity', c.last_activity_at, 'created', c.created_at, 'id', c.id)::text
  from app.customers c
  where c.anonymized_at is null
  order by c.has_activity desc, c.sort_at desc, c.id desc
  offset 499 limit 1
), true);

-- The plans ------------------------------------------------------------------------------
select matches(
  pg_temp.customers_scans(null, null, null, null, 20),
  '^Index (Only )?Scan using customers_home_order_idx$',
  'first page: an index scan on customers_home_order_idx'
);
select matches(
  pg_temp.customers_scans(null,
    (current_setting('plan_test.middle')::json ->> 'activity')::timestamptz,
    (current_setting('plan_test.middle')::json ->> 'created')::timestamptz,
    (current_setting('plan_test.middle')::json ->> 'id')::uuid, 20),
  '^Index (Only )?Scan using customers_home_order_idx$',
  'middle page: an index scan on customers_home_order_idx'
);
select matches(
  pg_temp.customers_scans('Piano 05', null, null, null, 20),
  '^Index (Only )?Scan using customers_home_order_idx$',
  'search: an index scan on customers_home_order_idx'
);

-- The copy is the function's query ------------------------------------------------------
select set_config('plan_test.expected', json_build_array(
  pg_temp.page_ids(null, null, null, null, 20),
  pg_temp.page_ids(null,
    (current_setting('plan_test.middle')::json ->> 'activity')::timestamptz,
    (current_setting('plan_test.middle')::json ->> 'created')::timestamptz,
    (current_setting('plan_test.middle')::json ->> 'id')::uuid, 20),
  pg_temp.page_ids('Piano 05', null, null, null, 20)
)::text, true);

select is(
  (select array_agg(json_array_length(e)) from json_array_elements(current_setting('plan_test.expected')::json) e),
  array[20, 20, 20],
  'the three pages are full: the comparisons below are not of empty pages'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a900-000000000001","role":"authenticated"}', true);

select is(
  array(select r.id from app.list_customers(null, null, null, null, 20) r),
  array(select json_array_elements_text(current_setting('plan_test.expected')::json -> 0)::uuid),
  'first page: list_customers returns the rows of the explained query'
);
select is(
  array(select r.id from app.list_customers(null,
    (current_setting('plan_test.middle')::json ->> 'activity')::timestamptz,
    (current_setting('plan_test.middle')::json ->> 'created')::timestamptz,
    (current_setting('plan_test.middle')::json ->> 'id')::uuid, 20) r),
  array(select json_array_elements_text(current_setting('plan_test.expected')::json -> 1)::uuid),
  'middle page: list_customers returns the rows of the explained query'
);
select is(
  array(select r.id from app.list_customers('Piano 05', null, null, null, 20) r),
  array(select json_array_elements_text(current_setting('plan_test.expected')::json -> 2)::uuid),
  'search: list_customers returns the rows of the explained query'
);

reset role;

select * from finish();
rollback;
