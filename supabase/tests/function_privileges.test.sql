-- No function in app or private may be executable by anon or PUBLIC, today or
-- when created later: callers must be signed in, and every grant is explicit.
-- In public, anon executes exactly the two functions of the public points page.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

create function app.privilege_probe() returns int language sql as $$ select 1 $$;
create function private.privilege_probe() returns int language sql as $$ select 1 $$;

select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    where p.pronamespace in ('app'::regnamespace, 'private'::regnamespace)
      and has_function_privilege('anon', p.oid, 'execute')
    order by 1
  ),
  array[]::text[],
  'anon cannot execute any function in app or private'
);
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.pronamespace in ('app'::regnamespace, 'private'::regnamespace)
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
    order by 1
  ),
  array[]::text[],
  'PUBLIC has no execute on any function in app or private'
);
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')
    order by 1
  ),
  array['card_points(text)', 'card_rewards(text)'],
  'in public anon executes exactly card_points and card_rewards'
);
select ok(
  has_function_privilege('authenticated', 'app.privilege_probe()', 'execute'),
  'a new function in app is executable by authenticated'
);
select ok(
  not has_function_privilege('authenticated', 'private.privilege_probe()', 'execute'),
  'a new function in private needs an explicit grant'
);

select * from finish();
rollback;
