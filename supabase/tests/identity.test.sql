-- identity: operator profiles, access helpers and the manual add_operator procedure
-- (SPEC-identity.md, "Modello dati e regole di accesso"). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000001', 'admin.test@example.com'),
  ('00000000-0000-4000-a000-000000000002', 'operator.test@example.com'),
  ('00000000-0000-4000-a000-000000000003', 'nobody.test@example.com'),
  ('00000000-0000-4000-a000-000000000004', 'back.test@example.com');

-- add_operator: create ------------------------------------------------------
select isnt(
  private.add_operator('admin.test@example.com', 'Admin Test', 'admin'),
  null,
  'add_operator creates a profile and returns its id'
);
select lives_ok(
  $$select private.add_operator('OPERATOR.test@example.com', '  Operatore Test  ', 'operator')$$,
  'add_operator matches the email case-insensitively'
);
select is(
  (select name from app.operators where user_id = '00000000-0000-4000-a000-000000000002'),
  'Operatore Test',
  'add_operator trims the name'
);
select throws_ok(
  $$select private.add_operator('missing@example.com', 'Nessuno', 'operator')$$,
  'P0001',
  null,
  'add_operator rejects an email without an Auth user'
);
select throws_ok(
  $$select private.add_operator('admin.test@example.com', 'Altro Nome', 'operator')$$,
  'P0001',
  null,
  'add_operator rejects an account already linked to another profile'
);
select throws_ok(
  $$select private.add_operator('nobody.test@example.com', 'admin test', 'operator')$$,
  'P0001',
  null,
  'add_operator rejects a name already linked to another account (case-insensitive)'
);
select throws_ok(
  $$select private.add_operator('nobody.test@example.com', 'Ruolo Strano', 'owner')$$,
  '23514',
  null,
  'role must be admin or operator'
);

-- Removing the Auth user keeps the profile, unlinked -------------------------
select private.add_operator('back.test@example.com', 'Rientro Test', 'operator');
delete from auth.users where id = '00000000-0000-4000-a000-000000000004';
select is(
  (select user_id from app.operators where name = 'Rientro Test'),
  null,
  'deleting the Auth user leaves the profile with user_id null'
);

-- ...and add_operator links it again, by name, with the new role
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000005', 'back.again@example.com');
select is(
  private.add_operator('back.again@example.com', 'Rientro Test', 'admin'),
  (select id from app.operators where name = 'Rientro Test'),
  'add_operator relinks the existing profile by name'
);
select is(
  (select role from app.operators where name = 'Rientro Test'),
  'admin',
  'relinking updates the role'
);
select lives_ok(
  $$select private.add_operator('back.again@example.com', 'Rientro Test', 'admin')$$,
  'add_operator is idempotent for the same account and name'
);

-- Privileges ------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'private.add_operator(text, text, text)', 'execute'),
  'authenticated cannot execute add_operator'
);
select ok(
  not has_function_privilege('anon', 'private.add_operator(text, text, text)', 'execute'),
  'anon cannot execute add_operator'
);
select ok(
  not has_function_privilege('service_role', 'private.add_operator(text, text, text)', 'execute'),
  'service_role cannot execute add_operator'
);

-- Signed-in operator ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*) from app.operators where name in ('Admin Test', 'Operatore Test', 'Rientro Test')),
  3::bigint,
  'an operator reads every colleague profile'
);
select ok(private.is_active_operator(), 'is_active_operator is true for a linked operator');
select ok(not private.is_admin(), 'is_admin is false for an operator');
select is(
  private.current_operator_id(),
  (select id from app.operators where name = 'Operatore Test'),
  'current_operator_id returns the linked profile'
);
select throws_ok(
  $$insert into app.operators (name, role) values ('Intruso', 'admin')$$,
  '42501',
  null,
  'an operator cannot insert profiles'
);
select throws_ok(
  $$update app.operators set role = 'admin'$$,
  '42501',
  null,
  'an operator cannot change profiles'
);

-- Signed-in admin -------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
select ok(private.is_admin(), 'is_admin is true for an admin');

-- Auth user without a profile (never linked, or removed and token still valid) ---------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*) from app.operators),
  0::bigint,
  'a user without a profile reads nothing'
);
select ok(not private.is_active_operator(), 'is_active_operator is false without a profile');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*) from app.operators),
  0::bigint,
  'the token of a deleted user reads nothing'
);
reset role;

select * from finish();
rollback;
