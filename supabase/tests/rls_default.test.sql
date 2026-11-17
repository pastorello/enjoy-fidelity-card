-- Every table created in schema app must have row level security enabled
-- automatically, so a table without policies exposes nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create table app.rls_probe (id int primary key, note text);
insert into app.rls_probe values (1, 'fake row');
create table app.rls_probe_ctas as select 1 as id;
create table public.outside_app (id int);

select ok(
  (select relrowsecurity from pg_class where oid = 'app.rls_probe'::regclass),
  'CREATE TABLE in app enables RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.rls_probe_ctas'::regclass),
  'CREATE TABLE AS in app enables RLS'
);
select ok(
  not (select relrowsecurity from pg_class where oid = 'public.outside_app'::regclass),
  'tables outside app are not touched'
);
select ok(
  not exists (
    select 1 from pg_tables
    where schemaname = 'app' and not rowsecurity and tablename not like 'rls_probe%'
  ),
  'no existing table in app has RLS disabled'
);

set local role authenticated;
select is(
  (select count(*) from app.rls_probe),
  0::bigint,
  'authenticated user reads no rows from a table without policies'
);
select throws_ok(
  $$insert into app.rls_probe values (2, 'x')$$,
  '42501',
  null,
  'authenticated user cannot insert into a table without policies'
);
reset role;

set local role anon;
select throws_ok(
  $$select count(*) from app.rls_probe$$,
  '42501',
  null,
  'anonymous role has no access to schema app'
);
reset role;

select * from finish();
rollback;
