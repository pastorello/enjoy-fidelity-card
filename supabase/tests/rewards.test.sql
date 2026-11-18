-- rewards: the rewards catalogue, its access rules and the write RPCs
-- (SPEC-rewards.md, "Modello dati e regole di accesso"). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(119);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-d000-000000000001', 'rewards.admin@example.com'),
  ('00000000-0000-4000-d000-000000000002', 'rewards.operator@example.com'),
  ('00000000-0000-4000-d000-000000000003', 'rewards.nobody@example.com'),
  ('00000000-0000-4000-d000-000000000004', 'rewards.admin2@example.com');
select private.add_operator('rewards.admin@example.com', 'Admin Premi', 'admin');
select private.add_operator('rewards.operator@example.com', 'Operatore Premi', 'operator');
select private.add_operator('rewards.admin2@example.com', 'Admin Premi Due', 'admin');

-- Returns the constraint name of the error a statement raises, or null when it
-- raises none. Lives only inside this rolled-back transaction.
create function public.rewards_test_error_constraint(p_sql text)
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
grant execute on function public.rewards_test_error_constraint(text) to authenticated;

-- Rows inserted, updated and deleted so far in this transaction in every table of app
-- except rewards, to prove the rewards RPCs write nothing else (success criterion 3).
-- Write counters, not row counts: an update leaves the counts as they were.
create function public.rewards_test_other_writes()
returns jsonb
language sql
as $$
  select coalesce(
    jsonb_object_agg(relname, n_tup_ins + n_tup_upd + n_tup_del order by relname),
    '{}'
  )
  from pg_stat_xact_user_tables
  where schemaname = 'app' and relname <> 'rewards';
$$;

-- Structure and privileges ------------------------------------------------------------
select has_table('app', 'rewards', 'app.rewards exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'app.rewards'::regclass),
  'RLS is enabled on app.rewards'
);
select index_is_unique('app', 'rewards', 'rewards_name_key', 'rewards_name_key is a unique index');
select is(
  (select pg_get_indexdef('app.rewards_name_key'::regclass)),
  'CREATE UNIQUE INDEX rewards_name_key ON app.rewards USING btree (lower(name))',
  'rewards_name_key is on lower(name)'
);
select ok(
  not has_table_privilege('authenticated', 'app.rewards', 'insert')
    and not has_table_privilege('authenticated', 'app.rewards', 'update')
    and not has_table_privilege('authenticated', 'app.rewards', 'delete')
    and not has_table_privilege('authenticated', 'app.rewards', 'truncate'),
  'authenticated has no insert, update, delete or truncate on app.rewards'
);
select ok(
  not has_table_privilege('anon', 'app.rewards', 'select'),
  'anon has no select on app.rewards'
);
select ok(
  has_function_privilege('authenticated', 'app.create_reward(uuid, text, int, boolean)', 'execute'),
  'authenticated can execute create_reward'
);
select ok(
  not has_function_privilege('anon', 'app.create_reward(uuid, text, int, boolean)', 'execute'),
  'anon cannot execute create_reward'
);
select ok(
  (select prosecdef from pg_proc where oid = 'app.create_reward(uuid, text, int, boolean)'::regprocedure),
  'create_reward is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'app.create_reward(uuid, text, int, boolean)'::regprocedure),
  array['search_path=""'],
  'create_reward pins an empty search_path'
);
select ok(
  not has_function_privilege('authenticated', 'private.acting_operator_id()', 'execute'),
  'authenticated cannot execute acting_operator_id'
);
select ok(
  not has_function_privilege('anon', 'private.acting_operator_id()', 'execute'),
  'anon cannot execute acting_operator_id'
);
select is(
  (select prosrc from pg_proc where oid = 'private.acting_operator_id()'::regprocedure),
  -- The common body as tablet-kiosk last redefines it (cross-review §2.1).
  E'\n  select coalesce(private.current_operator_id(), private.valid_cashier_id());\n',
  'acting_operator_id keeps the common body'
);
select ok(
  has_function_privilege('authenticated', 'app.update_reward(uuid, text, int)', 'execute'),
  'authenticated can execute update_reward'
);
select ok(
  not has_function_privilege('anon', 'app.update_reward(uuid, text, int)', 'execute'),
  'anon cannot execute update_reward'
);
select ok(
  (select prosecdef from pg_proc where oid = 'app.update_reward(uuid, text, int)'::regprocedure),
  'update_reward is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'app.update_reward(uuid, text, int)'::regprocedure),
  array['search_path=""'],
  'update_reward pins an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'app.set_reward_active(uuid, boolean)', 'execute'),
  'authenticated can execute set_reward_active'
);
select ok(
  not has_function_privilege('anon', 'app.set_reward_active(uuid, boolean)', 'execute'),
  'anon cannot execute set_reward_active'
);
select ok(
  (select prosecdef from pg_proc where oid = 'app.set_reward_active(uuid, boolean)'::regprocedure),
  'set_reward_active is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'app.set_reward_active(uuid, boolean)'::regprocedure),
  array['search_path=""'],
  'set_reward_active pins an empty search_path'
);

-- Rewards are never deleted (success criterion 3) ------------------------------------------
select triggers_are('app', 'rewards', array[]::name[], 'app.rewards has no triggers');
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    where p.pronamespace in ('app'::regnamespace, 'private'::regnamespace)
      and p.prosrc ~* '(delete\s+from|truncate(\s+table)?)\s+(only\s+)?app\.rewards\M'
    order by 1
  ),
  array[]::text[],
  'no function in app or private deletes from app.rewards'
);
select is(
  array(
    select r.rolname::text
    from pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and (has_table_privilege(r.oid, 'app.rewards', 'delete')
        or has_table_privilege(r.oid, 'app.rewards', 'truncate'))
    order by 1
  ),
  array[]::text[],
  'no API role (anon, authenticated, service_role) can delete or truncate app.rewards'
);
select is(
  (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')),
  3::bigint,
  'the three API roles exist, so the check above is not vacuous'
);

-- A reward to read, written as the table owner.
insert into app.rewards (id, name, points, created_by, updated_by)
select '00000000-0000-4000-d100-000000000001', 'Caffè Premi', 50, id, id
from app.operators where name = 'Admin Premi';

-- anon ------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from app.rewards$$, '42501', null, 'anon cannot read rewards');
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000009', 'Anon', 10, true)$$,
  '42501',
  null,
  'anon cannot call create_reward'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000001', 'Anon', 10)$$,
  '42501',
  null,
  'anon cannot call update_reward'
);
select throws_ok(
  $$select app.set_reward_active('00000000-0000-4000-d100-000000000001', false)$$,
  '42501',
  null,
  'anon cannot call set_reward_active'
);
reset role;

-- Signed-in operator ----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$select name, points, active from app.rewards where id::text like '00000000-0000-4000-d100-%'$$,
  $$values ('Caffè Premi'::text, 50, true)$$,
  'an active operator reads the rewards'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000002', 'Spremuta Operatore', 80, true)$$,
  '42501',
  null,
  'an operator cannot call create_reward'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000001', 'Caffè Premi', 50, true)$$,
  '42501',
  null,
  'an operator resending an existing id still gets 42501'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000001', 'Caffè Operatore', 40)$$,
  '42501',
  null,
  'an operator cannot call update_reward'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-0000000000ff', 'Inesistente', 40)$$,
  '42501',
  null,
  'an operator gets 42501 from update_reward even for a missing id'
);
select throws_ok(
  $$select app.set_reward_active('00000000-0000-4000-d100-000000000001', false)$$,
  '42501',
  null,
  'an operator cannot call set_reward_active'
);
select throws_ok(
  $$select app.set_reward_active('00000000-0000-4000-d100-0000000000ff', false)$$,
  '42501',
  null,
  'an operator gets 42501 from set_reward_active even for a missing id'
);
select throws_ok(
  $$insert into app.rewards (id, name, points, created_by, updated_by)
    values (gen_random_uuid(), 'Diretto', 10, gen_random_uuid(), gen_random_uuid())$$,
  '42501',
  null,
  'an operator cannot insert directly'
);
select throws_ok($$update app.rewards set points = 1$$, '42501', null, 'an operator cannot update directly');
select throws_ok($$delete from app.rewards$$, '42501', null, 'an operator cannot delete directly');

-- Auth user without a profile ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000003","role":"authenticated"}', true);
select is((select count(*) from app.rewards), 0::bigint, 'a user without a profile reads nothing');
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000003', 'Spremuta Nessuno', 80, true)$$,
  '42501',
  null,
  'a user without a profile cannot call create_reward'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000001', 'Caffè Premi', 50, true)$$,
  '42501',
  null,
  'a user without a profile resending an existing id still gets 42501'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000001', 'Caffè Nessuno', 40)$$,
  '42501',
  null,
  'a user without a profile cannot call update_reward'
);
select throws_ok(
  $$select app.set_reward_active('00000000-0000-4000-d100-000000000001', false)$$,
  '42501',
  null,
  'a user without a profile cannot call set_reward_active'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-0000000000ff', 'Inesistente', 40)$$,
  '42501',
  null,
  'a user without a profile gets 42501 from update_reward even for a missing id'
);

-- Signed-in admin: direct writes ----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$select name from app.rewards where id::text like '00000000-0000-4000-d100-%'$$,
  $$values ('Caffè Premi'::text)$$,
  'an admin reads the rewards'
);
select throws_ok(
  $$insert into app.rewards (id, name, points, created_by, updated_by)
    values (gen_random_uuid(), 'Diretto', 10, gen_random_uuid(), gen_random_uuid())$$,
  '42501',
  null,
  'an admin cannot insert directly'
);
select throws_ok($$update app.rewards set points = 1$$, '42501', null, 'an admin cannot update directly');
select throws_ok($$delete from app.rewards$$, '42501', null, 'an admin cannot delete directly');
select throws_ok($$truncate app.rewards$$, '42501', null, 'an admin cannot truncate');

reset role;
select is(
  (select count(*) from app.rewards where id::text like '00000000-0000-4000-d100-%'),
  1::bigint,
  'refused calls add no reward'
);
select results_eq(
  $$select name, points, active from app.rewards where id::text like '00000000-0000-4000-d100-%'$$,
  $$values ('Caffè Premi'::text, 50, true)$$,
  'refused calls leave the reward unchanged'
);

-- Signed-in admin: create_reward -----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$select id, name, points, active
    from app.create_reward('00000000-0000-4000-d100-000000000010', ' Spremuta ', 80, true)$$,
  $$values ('00000000-0000-4000-d100-000000000010'::uuid, 'Spremuta'::text, 80, true)$$,
  'an admin creates a reward, the name saved without leading and trailing spaces'
);
select results_eq(
  $$select id, name, points, active
    from app.create_reward('00000000-0000-4000-d100-000000000010', 'Altro nome', 10, false)$$,
  $$values ('00000000-0000-4000-d100-000000000010'::uuid, 'Spremuta'::text, 80, true)$$,
  'the same id with a different name returns the existing row unchanged'
);
select results_eq(
  $$select name from app.create_reward('00000000-0000-4000-d100-000000000010', 'Caffè Premi', 50, true)$$,
  $$values ('Spremuta'::text)$$,
  'a resent id is not checked against the names already used'
);
select results_eq(
  $$select name from app.create_reward('00000000-0000-4000-d100-000000000010', '', 0, true)$$,
  $$values ('Spremuta'::text)$$,
  'a resent id is not validated again'
);
select is(
  (select count(*) from app.rewards where id = '00000000-0000-4000-d100-000000000010'),
  1::bigint,
  'the same id sent four times makes one row'
);
select results_eq(
  $$select active from app.create_reward('00000000-0000-4000-d100-000000000011', 'Dolce Premi', 120, false)$$,
  $$values (false)$$,
  'an admin creates an inactive reward'
);
select results_eq(
  $$select name, points from app.create_reward('00000000-0000-4000-d100-000000000012', repeat('a', 60), 1, true)$$,
  $$values (repeat('a', 60), 1)$$,
  'a name of 60 characters and 1 point are accepted'
);
select results_eq(
  $$select points from app.create_reward('00000000-0000-4000-d100-000000000013', 'Massimo Premi', 99999, true)$$,
  $$values (99999)$$,
  '99 999 points are accepted'
);
-- Outer whitespace is any Unicode space, as String.trim() in the app: no-break spaces
-- (U+00A0, U+202F) come with names pasted from chats.
select results_eq(
  $$select name from app.create_reward('00000000-0000-4000-d100-000000000014', 'Cornetto' || chr(160), 40, true)$$,
  $$values ('Cornetto'::text)$$,
  'a trailing no-break space is not saved'
);
select results_eq(
  $$select name from app.create_reward('00000000-0000-4000-d100-000000000015', chr(9) || 'Tramezzino' || chr(8239), 60, true)$$,
  $$values ('Tramezzino'::text)$$,
  'a leading tab and a trailing narrow no-break space are not saved'
);

-- Duplicate names ---------------------------------------------------------------------------------
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000020', 'SPREMUTA', 80, true)$$,
  '23505',
  null,
  'a duplicate name in different case is refused'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000021', '  spremuta  ', 80, true)$$,
  '23505',
  null,
  'a duplicate name with leading and trailing spaces is refused'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000023', chr(160) || 'Spremuta' || chr(160), 80, true)$$,
  '23505', null, 'a duplicate name between no-break spaces is refused'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000024', 'spremuta' || chr(8239), 80, true)$$,
  '23505', null, 'a duplicate name ending in a narrow no-break space is refused'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000025', chr(9) || 'SPREMUTA' || chr(9), 80, true)$$,
  '23505', null, 'a duplicate name between tabs is refused'
);
select is(
  public.rewards_test_error_constraint(
    $$select app.create_reward('00000000-0000-4000-d100-000000000022', 'Spremuta', 80, true)$$
  ),
  'rewards_name_key',
  'a duplicate name reports the rewards_name_key constraint'
);

-- Values out of range -------------------------------------------------------------------------------
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000030', 'Zero', 0, true)$$,
  '23514', null, '0 points are refused'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000031', 'Negativo', -5, true)$$,
  '23514', null, 'negative points are refused'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000032', 'Troppi', 100000, true)$$,
  '23514', null, '100 000 points are refused'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000033', '', 10, true)$$,
  '23514', null, 'an empty name is refused'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000034', '   ', 10, true)$$,
  '23514', null, 'a name of only spaces is refused'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000035', repeat('b', 61), 10, true)$$,
  '23514', null, 'a name of 61 characters is refused'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000036', null, 10, true)$$,
  '23514', null, 'a null name is refused as invalid'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000037', 'Senza punti', null, true)$$,
  '23514', null, 'null points are refused as invalid'
);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000038', 'Senza stato', 10, null)$$,
  '23514', null, 'a null active flag is refused as invalid'
);
select throws_ok(
  $$select app.create_reward(null, 'Senza id', 10, true)$$,
  '23514', null, 'a null id is refused as invalid'
);
reset role;

select is(
  (select count(*) from app.rewards where id::text like '00000000-0000-4000-d100-00000000003%'),
  0::bigint,
  'refused values add no reward'
);

select throws_ok(
  $$insert into app.rewards (id, name, points, created_by, updated_by)
    select '00000000-0000-4000-d100-000000000016', 'Riga' || chr(160), 10, id, id
    from app.operators where name = 'Admin Premi'$$,
  '23514', null, 'the table refuses a name with an outer no-break space'
);

-- Authors ---------------------------------------------------------------------------------------------
select results_eq(
  $$select created_by, updated_by from app.rewards where id = '00000000-0000-4000-d100-000000000010'$$,
  $$select id, id from app.operators where name = 'Admin Premi'$$,
  'created_by and updated_by are the acting operator'
);
select ok(
  (select created_at <= now() and updated_at = created_at
   from app.rewards where id = '00000000-0000-4000-d100-000000000010'),
  'created_at and updated_at are set at creation'
);

-- update_reward and set_reward_active -------------------------------------------------------
-- Snapshot of the writes to the other tables, and timestamps moved to the past so a change
-- is visible.
create temp table rewards_test_writes_before as
  select public.rewards_test_other_writes() as writes;
select ok(
  (select writes ? 'operators' and writes ? 'customers' from rewards_test_writes_before),
  'the write snapshot covers the other tables of app'
);
update app.rewards
set updated_at = now() - interval '1 day'
where id in ('00000000-0000-4000-d100-000000000010', '00000000-0000-4000-d100-000000000011');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000004","role":"authenticated"}', true);

select results_eq(
  $$select id, name, points, active
    from app.update_reward('00000000-0000-4000-d100-000000000010', ' Spremuta grande ', 90)$$,
  $$values ('00000000-0000-4000-d100-000000000010'::uuid, 'Spremuta grande'::text, 90, true)$$,
  'an admin renames a reward and changes its points, the name saved without outer spaces'
);
select results_eq(
  $$select name, points, active
    from app.update_reward('00000000-0000-4000-d100-000000000011', 'Dolce Premi', 130)$$,
  $$values ('Dolce Premi'::text, 130, false)$$,
  'update_reward does not change active'
);
select results_eq(
  $$select name from app.update_reward('00000000-0000-4000-d100-000000000010', 'SPREMUTA GRANDE', 90)$$,
  $$values ('SPREMUTA GRANDE'::text)$$,
  'a reward can be renamed to its own name in a different case'
);
select results_eq(
  $$select name from app.update_reward('00000000-0000-4000-d100-000000000012', chr(9) || 'Ghiacciolo' || chr(8239), 1)$$,
  $$values ('Ghiacciolo'::text)$$,
  'update_reward saves the name without outer tabs and no-break spaces'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000012', chr(160) || 'dolce premi' || chr(160), 1)$$,
  '23505', null, 'renaming to a name already used, between no-break spaces, is refused'
);

-- Refused updates
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', 'caffè premi', 90)$$,
  '23505', null, 'renaming to a name already used, in different case, is refused'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', '  Dolce Premi  ', 90)$$,
  '23505', null, 'renaming to a name already used, with outer spaces, is refused'
);
select is(
  public.rewards_test_error_constraint(
    $$select app.update_reward('00000000-0000-4000-d100-000000000010', 'Caffè Premi', 90)$$
  ),
  'rewards_name_key',
  'a rename to a used name reports the rewards_name_key constraint'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', 'Spremuta', 0)$$,
  '23514', null, 'update_reward refuses 0 points'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', 'Spremuta', -1)$$,
  '23514', null, 'update_reward refuses negative points'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', 'Spremuta', 100000)$$,
  '23514', null, 'update_reward refuses 100 000 points'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', 'Spremuta', null)$$,
  '23514', null, 'update_reward refuses null points'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', '', 90)$$,
  '23514', null, 'update_reward refuses an empty name'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', '   ', 90)$$,
  '23514', null, 'update_reward refuses a name of only spaces'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', repeat('c', 61), 90)$$,
  '23514', null, 'update_reward refuses a name of 61 characters'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', null, 90)$$,
  '23514', null, 'update_reward refuses a null name'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-0000000000ff', 'Inesistente', 90)$$,
  'P0002', null, 'update_reward on a missing id raises P0002'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-0000000000ff', '', 0)$$,
  'P0002', null, 'update_reward checks the id before the values'
);
select throws_ok(
  $$select app.update_reward(null, 'Senza id', 90)$$,
  'P0002', null, 'update_reward with a null id raises P0002'
);
select results_eq(
  $$select name, points, active from app.rewards where id = '00000000-0000-4000-d100-000000000010'$$,
  $$values ('SPREMUTA GRANDE'::text, 90, true)$$,
  'refused updates leave the reward unchanged'
);

-- set_reward_active
select results_eq(
  $$select id, name, points, active
    from app.set_reward_active('00000000-0000-4000-d100-000000000010', false)$$,
  $$values ('00000000-0000-4000-d100-000000000010'::uuid, 'SPREMUTA GRANDE'::text, 90, false)$$,
  'an admin deactivates a reward, name and points unchanged'
);
select results_eq(
  $$select active from app.set_reward_active('00000000-0000-4000-d100-000000000010', false)$$,
  $$values (false)$$,
  'deactivating an inactive reward is harmless'
);
select results_eq(
  $$select active from app.set_reward_active('00000000-0000-4000-d100-000000000010', true)$$,
  $$values (true)$$,
  'an admin reactivates a reward'
);
select results_eq(
  $$select active from app.set_reward_active('00000000-0000-4000-d100-000000000011', true)$$,
  $$values (true)$$,
  'an admin activates a reward created inactive'
);
select throws_ok(
  $$select app.set_reward_active('00000000-0000-4000-d100-000000000010', null)$$,
  '23514', null, 'set_reward_active refuses a null flag'
);
select throws_ok(
  $$select app.set_reward_active('00000000-0000-4000-d100-0000000000ff', false)$$,
  'P0002', null, 'set_reward_active on a missing id raises P0002'
);
select throws_ok(
  $$select app.set_reward_active('00000000-0000-4000-d100-0000000000ff', null)$$,
  'P0002', null, 'set_reward_active checks the id before the values'
);
reset role;

select results_eq(
  $$select r.id, r.updated_by, r.created_by
    from app.rewards r
    where r.id in ('00000000-0000-4000-d100-000000000010', '00000000-0000-4000-d100-000000000011')
    order by r.id$$,
  $$select v.id, due.id, premi.id
    from (values ('00000000-0000-4000-d100-000000000010'::uuid), ('00000000-0000-4000-d100-000000000011'::uuid)) as v (id)
    cross join (select id from app.operators where name = 'Admin Premi Due') as due
    cross join (select id from app.operators where name = 'Admin Premi') as premi
    order by v.id$$,
  'updated_by is the acting operator, created_by is unchanged'
);
select ok(
  (select bool_and(updated_at = now())
   from app.rewards
   where id in ('00000000-0000-4000-d100-000000000010', '00000000-0000-4000-d100-000000000011')),
  'updated_at is set to now() by update_reward and set_reward_active'
);
select is(
  public.rewards_test_other_writes(),
  (select writes from rewards_test_writes_before),
  'the rewards RPCs change no other table in app'
);
-- The check sees an update that leaves every row count as it was.
update app.operators set name = name where name = 'Admin Premi';
select isnt(
  public.rewards_test_other_writes(),
  (select writes from rewards_test_writes_before),
  'the check above would see an update of another table'
);

-- A missing author is refused: pretend acting_operator_id() returns null
-- (tablet-kiosk redefines it; a reward never exists without an author).
create or replace function private.acting_operator_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select null::uuid;
$$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select app.create_reward('00000000-0000-4000-d100-000000000040', 'Senza autore', 10, true)$$,
  '42501',
  null,
  'an admin without an acting operator gets 42501'
);
select throws_ok(
  $$select app.update_reward('00000000-0000-4000-d100-000000000010', 'Senza autore', 10)$$,
  '42501',
  null,
  'update_reward without an acting operator gets 42501'
);
select throws_ok(
  $$select app.set_reward_active('00000000-0000-4000-d100-000000000010', false)$$,
  '42501',
  null,
  'set_reward_active without an acting operator gets 42501'
);
reset role;
select is(
  (select count(*) from app.rewards where id = '00000000-0000-4000-d100-000000000040'),
  0::bigint,
  'no reward is created without an author'
);
select results_eq(
  $$select name, active from app.rewards where id = '00000000-0000-4000-d100-000000000010'$$,
  $$values ('SPREMUTA GRANDE'::text, true)$$,
  'nothing changes without an author'
);

select * from finish();
rollback;
