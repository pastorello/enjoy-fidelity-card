-- public.card_points and public.card_rewards, the only functions anyone without
-- an account may run, and the allowlist of what anon can execute (SPEC-cards.md,
-- "Modello dati e regole di accesso", criteria 8, 11, 12; SPEC-customers-v2.md §3).
-- Fake data only: invented uids and names; tokens are generated inside this
-- rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-f000-000000000001', 'points.admin@example.com'),
  ('00000000-0000-4000-f000-000000000002', 'points.operator@example.com');
select private.add_operator('points.admin@example.com', 'Admin Punti', 'admin');
select private.add_operator('points.operator@example.com', 'Operatore Punti', 'operator');

-- Fake customers, one per case: Gino (link confirmed), Ivo (link only pending),
-- Lia (card deactivated), Mara (anonymized), Nico (link rotated), Olga (card
-- replaced), Pia (anonymized without the trigger: the clause on anonymized_at),
-- Rita (card deactivated, then released).
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
select fake.id, fake.name, now(), (select id from app.operators where name = 'Admin Punti'), fake.op
from (values
  ('00000000-0000-4000-f100-000000000001'::uuid, 'Gino Punti', '00000000-0000-4000-f200-000000000001'::uuid),
  ('00000000-0000-4000-f100-000000000002'::uuid, 'Ivo Punti', '00000000-0000-4000-f200-000000000002'::uuid),
  ('00000000-0000-4000-f100-000000000003'::uuid, 'Lia Punti', '00000000-0000-4000-f200-000000000003'::uuid),
  ('00000000-0000-4000-f100-000000000004'::uuid, 'Mara Punti', '00000000-0000-4000-f200-000000000004'::uuid),
  ('00000000-0000-4000-f100-000000000005'::uuid, 'Nico Punti', '00000000-0000-4000-f200-000000000005'::uuid),
  ('00000000-0000-4000-f100-000000000006'::uuid, 'Olga Punti', '00000000-0000-4000-f200-000000000006'::uuid),
  ('00000000-0000-4000-f100-000000000007'::uuid, 'Pia Punti', '00000000-0000-4000-f200-000000000007'::uuid),
  ('00000000-0000-4000-f100-000000000008'::uuid, 'Rita Punti', '00000000-0000-4000-f200-000000000008'::uuid)
) as fake (id, name, op);

insert into app.cards (id, uid, customer_id, active, associated_by)
select fake.id, fake.uid, fake.customer_id, true, (select id from app.operators where name = 'Admin Punti')
from (values
  ('00000000-0000-4000-f300-000000000001'::uuid, '04EEFF00000001', '00000000-0000-4000-f100-000000000001'::uuid),
  ('00000000-0000-4000-f300-000000000002'::uuid, '04EEFF00000002', '00000000-0000-4000-f100-000000000002'::uuid),
  ('00000000-0000-4000-f300-000000000003'::uuid, '04EEFF00000003', '00000000-0000-4000-f100-000000000003'::uuid),
  ('00000000-0000-4000-f300-000000000004'::uuid, '04EEFF00000004', '00000000-0000-4000-f100-000000000004'::uuid),
  ('00000000-0000-4000-f300-000000000005'::uuid, '04EEFF00000005', '00000000-0000-4000-f100-000000000005'::uuid),
  ('00000000-0000-4000-f300-000000000006'::uuid, '04EEFF00000006', '00000000-0000-4000-f100-000000000006'::uuid),
  ('00000000-0000-4000-f300-000000000007'::uuid, '04EEFF00000007', '00000000-0000-4000-f100-000000000007'::uuid),
  ('00000000-0000-4000-f300-000000000008'::uuid, '04EEFF00000008', '00000000-0000-4000-f100-000000000008'::uuid)
) as fake (id, uid, customer_id);

-- Fake catalogue for card_rewards: the seed rewards are switched off inside this
-- transaction, so only these rows count. Two share 100 points (order by name,
-- case-insensitive); one is inactive.
update app.rewards set active = false;
insert into app.rewards (id, name, points, active, created_by, updated_by)
select fake.id, fake.name, fake.points, fake.active, admin.id, admin.id
from (values
  ('00000000-0000-4000-f400-000000000001'::uuid, 'Premio finto aperitivo', 300, true),
  ('00000000-0000-4000-f400-000000000002'::uuid, 'premio finto caffè', 100, true),
  ('00000000-0000-4000-f400-000000000003'::uuid, 'Premio finto brioche', 100, true),
  ('00000000-0000-4000-f400-000000000004'::uuid, 'Premio finto acqua', 50, true),
  ('00000000-0000-4000-f400-000000000005'::uuid, 'Premio finto spento', 10, false)
) as fake (id, name, points, active)
cross join (select id from app.operators where name = 'Admin Punti') as admin;

-- Shape and privileges ---------------------------------------------------------------
select ok(
  has_function_privilege('anon', 'public.card_points(text)', 'execute'),
  'anon can execute card_points'
);
select ok(
  has_function_privilege('authenticated', 'public.card_points(text)', 'execute'),
  'authenticated can execute card_points'
);
select is(
  (select count(*) from pg_proc p
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
   where p.oid = 'public.card_points(text)'::regprocedure and acl.grantee = 0),
  0::bigint,
  'PUBLIC has no privilege on card_points'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.card_points(text)'::regprocedure),
  'card_points is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'public.card_points(text)'::regprocedure),
  array['search_path=""'],
  'card_points runs with an empty search_path'
);
select is(
  (select provolatile::text from pg_proc where oid = 'public.card_points(text)'::regprocedure),
  's',
  'card_points is stable: it cannot write'
);
select is(
  pg_get_function_result('public.card_points(text)'::regprocedure),
  'integer',
  'card_points returns only an integer'
);

-- card_rewards: same guard rails as card_points.
select ok(
  has_function_privilege('anon', 'public.card_rewards(text)', 'execute'),
  'anon can execute card_rewards'
);
select ok(
  has_function_privilege('authenticated', 'public.card_rewards(text)', 'execute'),
  'authenticated can execute card_rewards'
);
select is(
  (select count(*) from pg_proc p
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
   where p.oid = 'public.card_rewards(text)'::regprocedure and acl.grantee = 0),
  0::bigint,
  'PUBLIC has no privilege on card_rewards'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.card_rewards(text)'::regprocedure),
  'card_rewards is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'public.card_rewards(text)'::regprocedure),
  array['search_path=""'],
  'card_rewards runs with an empty search_path'
);
select is(
  (select provolatile::text from pg_proc where oid = 'public.card_rewards(text)'::regprocedure),
  's',
  'card_rewards is stable: it cannot write'
);
select is(
  pg_get_function_result('public.card_rewards(text)'::regprocedure),
  'TABLE(name text, points integer)',
  'card_rewards returns only the name and the points'
);

-- The token check shared by both: private, never reachable from outside.
select ok(
  not (select prosecdef from pg_proc where oid = 'private.card_customer_for_token(text)'::regprocedure),
  'card_customer_for_token is security invoker: it runs only inside the two definer functions'
);
select is(
  (select proconfig from pg_proc where oid = 'private.card_customer_for_token(text)'::regprocedure),
  array['search_path=""'],
  'card_customer_for_token runs with an empty search_path'
);
select ok(
  not has_function_privilege('anon', 'private.card_customer_for_token(text)', 'execute')
    and not has_function_privilege('authenticated', 'private.card_customer_for_token(text)', 'execute'),
  'neither anon nor authenticated can execute card_customer_for_token'
);

-- Allowlist: Supabase grants execute to anon on every new function in public, so
-- any function added there by mistake would be reachable without an account.
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')
    order by 1
  ),
  array['card_points(text)', 'card_rewards(text)'],
  'in public anon executes exactly card_points(text) and card_rewards(text)'
);
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    where p.pronamespace in ('app'::regnamespace, 'private'::regnamespace)
      and has_function_privilege('anon', p.oid, 'execute')
    order by 1
  ),
  array[]::text[],
  'anon executes no function in app or private'
);

-- Links issued and confirmed by an operator --------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-f000-000000000002","role":"authenticated"}', true);

-- Gino: confirmed.
select set_config('points_test.gino', app.issue_card_link('00000000-0000-4000-f300-000000000001'), true);
select app.confirm_card_link('00000000-0000-4000-f300-000000000001', current_setting('points_test.gino'));
-- Ivo: issued only.
select set_config('points_test.ivo', app.issue_card_link('00000000-0000-4000-f300-000000000002'), true);
-- Lia: confirmed, then the card is deactivated.
select set_config('points_test.lia', app.issue_card_link('00000000-0000-4000-f300-000000000003'), true);
select app.confirm_card_link('00000000-0000-4000-f300-000000000003', current_setting('points_test.lia'));
select app.deactivate_card('00000000-0000-4000-f300-000000000003');
-- Mara: confirmed, then anonymized (below, as admin).
select set_config('points_test.mara', app.issue_card_link('00000000-0000-4000-f300-000000000004'), true);
select app.confirm_card_link('00000000-0000-4000-f300-000000000004', current_setting('points_test.mara'));
-- Nico: confirmed, rotated to a new confirmed token, then a third token left pending.
select set_config('points_test.nico_old', app.issue_card_link('00000000-0000-4000-f300-000000000005'), true);
select app.confirm_card_link('00000000-0000-4000-f300-000000000005', current_setting('points_test.nico_old'));
select set_config('points_test.nico_new', app.issue_card_link('00000000-0000-4000-f300-000000000005'), true);
select app.confirm_card_link('00000000-0000-4000-f300-000000000005', current_setting('points_test.nico_new'));
select set_config('points_test.nico_pending', app.issue_card_link('00000000-0000-4000-f300-000000000005'), true);
-- Olga: confirmed, then the card is replaced by a new one.
select set_config('points_test.olga', app.issue_card_link('00000000-0000-4000-f300-000000000006'), true);
select app.confirm_card_link('00000000-0000-4000-f300-000000000006', current_setting('points_test.olga'));
select app.associate_card('00000000-0000-4000-f100-000000000006', '04EEFF00000016');
-- Pia: confirmed.
select set_config('points_test.pia', app.issue_card_link('00000000-0000-4000-f300-000000000007'), true);
select app.confirm_card_link('00000000-0000-4000-f300-000000000007', current_setting('points_test.pia'));
-- Rita: confirmed, then the card is deactivated (and released below, as admin).
select set_config('points_test.rita', app.issue_card_link('00000000-0000-4000-f300-000000000008'), true);
select app.confirm_card_link('00000000-0000-4000-f300-000000000008', current_setting('points_test.rita'));
select app.deactivate_card('00000000-0000-4000-f300-000000000008');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-f000-000000000001","role":"authenticated"}', true);
select app.anonymize_customer('00000000-0000-4000-f100-000000000004');
select app.release_card('00000000-0000-4000-f500-000000000001', '00000000-0000-4000-f300-000000000008');
reset role;

-- Pia: anonymized with the trigger off, so her card and link survive. Only the
-- clause on anonymized_at in card_points stands between the link and the points.
alter table app.customers disable trigger customers_after_anonymize;
update app.customers set anonymized_at = now(), name = 'Cliente cancellato punti'
where id = '00000000-0000-4000-f100-000000000007';
alter table app.customers enable trigger customers_after_anonymize;
select ok(
  (select active from app.cards where id = '00000000-0000-4000-f300-000000000007')
    and exists (select 1 from private.card_links
                where card_id = '00000000-0000-4000-f300-000000000007' and token_hash is not null),
  'Pia''s card and link survive her anonymization in this fixture'
);

-- anon --------------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$select * from private.card_links$$, '42501', null, 'anon cannot read card_links');
select throws_ok($$select * from app.cards$$, '42501', null, 'anon cannot read cards');
select throws_ok(
  $$select app.issue_card_link('00000000-0000-4000-f300-000000000001')$$,
  '42501', null, 'anon cannot run issue_card_link'
);
select throws_ok(
  $$select app.confirm_card_link('00000000-0000-4000-f300-000000000001', 'AAAAAAAAAAAAAAAAAAAAAA')$$,
  '42501', null, 'anon cannot run confirm_card_link'
);

select is(public.card_points(current_setting('points_test.gino')), 0, 'a confirmed link without movements gives 0');
select is(
  current_setting('response.headers', true),
  '[{"Cache-Control": "no-store"}]',
  'card_points asks for Cache-Control: no-store'
);
select is(public.card_points(current_setting('points_test.nico_new')), 0, 'the link confirmed last gives the points');

-- Every refusal is the same null, never an error.
select set_config('response.headers', '', true);
select is(public.card_points('AAAAAAAAAAAAAAAAAAAAAA'), null::integer, 'an unknown token gives null');
select is(
  current_setting('response.headers', true),
  '[{"Cache-Control": "no-store"}]',
  'a refused token also gets Cache-Control: no-store'
);
select set_config('response.headers', '', true);
select is(public.card_points(null), null::integer, 'a null token gives null');
select is(
  current_setting('response.headers', true),
  '[{"Cache-Control": "no-store"}]',
  'a null token also gets Cache-Control: no-store'
);
select is(public.card_points(''), null::integer, 'an empty token gives null');
select is(public.card_points(repeat('A', 21)), null::integer, 'a 21-character token gives null');
select is(public.card_points(repeat('A', 23)), null::integer, 'a 23-character token gives null');
select is(
  public.card_points(left(current_setting('points_test.gino'), 21)),
  null::integer,
  'a confirmed token cut to 21 characters gives null'
);
select is(
  public.card_points(current_setting('points_test.gino') || 'A'),
  null::integer,
  'a confirmed token with one character more gives null'
);
select is(public.card_points('AAAAAAAAAAAAAAAAAAAAA+'), null::integer, 'a token with + gives null');
select is(public.card_points('AAAAAAAAAAAAAAAAAAAAA/'), null::integer, 'a token with / gives null');
select is(public.card_points('AAAAAAAAAAAAAAAAAAAAA='), null::integer, 'a token with = gives null');
select is(public.card_points(' ' || repeat('A', 21)), null::integer, 'a token with a space gives null');
select is(
  public.card_points(current_setting('points_test.ivo')),
  null::integer,
  'a token only issued, never confirmed, gives null'
);
select is(
  public.card_points(current_setting('points_test.nico_pending')),
  null::integer,
  'a pending token next to a confirmed one gives null'
);
select is(
  public.card_points(current_setting('points_test.nico_old')),
  null::integer,
  'the old token after a rotation gives null'
);
select is(
  public.card_points(current_setting('points_test.lia')),
  null::integer,
  'the link of a deactivated card gives null'
);
select is(
  public.card_points(current_setting('points_test.olga')),
  null::integer,
  'the link of a replaced card gives null'
);
select is(
  public.card_points(current_setting('points_test.mara')),
  null::integer,
  'the link of an anonymized customer gives null'
);
select is(
  public.card_points(current_setting('points_test.pia')),
  null::integer,
  'a surviving link of an anonymized customer still gives null'
);
reset role;

-- An operator gets the same answer, nothing more.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-f000-000000000002","role":"authenticated"}', true);
select is(public.card_points(current_setting('points_test.gino')), 0, 'an operator gets the same number');
select is(public.card_points(current_setting('points_test.lia')), null::integer, 'and the same null');
reset role;

-- card_rewards ----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select set_config('response.headers', '', true);
select results_eq(
  $$select name, points from public.card_rewards(current_setting('points_test.gino'))$$,
  $$values ('Premio finto acqua'::text, 50),
           ('Premio finto brioche', 100),
           ('premio finto caffè', 100),
           ('Premio finto aperitivo', 300)$$,
  'a confirmed link gives only the active rewards, by points and then by name'
);
select is(
  current_setting('response.headers', true),
  '[{"Cache-Control": "no-store"}]',
  'card_rewards asks for Cache-Control: no-store'
);
select is(
  (select count(*) from public.card_rewards(current_setting('points_test.nico_new'))),
  4::bigint,
  'the link confirmed last gives the rewards'
);

-- Every refusal is the same zero rows, never an error.
select set_config('response.headers', '', true);
select is_empty($$select * from public.card_rewards(null)$$, 'a null token gives no rewards');
select is(
  current_setting('response.headers', true),
  '[{"Cache-Control": "no-store"}]',
  'a null token also gets Cache-Control: no-store'
);
select set_config('response.headers', '', true);
select is_empty(
  $$select * from public.card_rewards('AAAAAAAAAAAAAAAAAAAAAA')$$,
  'an unknown token gives no rewards'
);
select is(
  current_setting('response.headers', true),
  '[{"Cache-Control": "no-store"}]',
  'a refused token also gets Cache-Control: no-store'
);
select is_empty($$select * from public.card_rewards('')$$, 'an empty token gives no rewards');
select is_empty(
  $$select * from public.card_rewards(left(current_setting('points_test.gino'), 21))$$,
  'a confirmed token cut to 21 characters gives no rewards'
);
select is_empty(
  $$select * from public.card_rewards(current_setting('points_test.gino') || 'A')$$,
  'a confirmed token with one character more gives no rewards'
);
select is_empty(
  $$select * from public.card_rewards('AAAAAAAAAAAAAAAAAAAAA+')$$,
  'a token with + gives no rewards'
);
select is_empty(
  $$select * from public.card_rewards(current_setting('points_test.ivo'))$$,
  'a token only issued, never confirmed, gives no rewards'
);
select is_empty(
  $$select * from public.card_rewards(current_setting('points_test.nico_pending'))$$,
  'a pending token next to a confirmed one gives no rewards'
);
select is_empty(
  $$select * from public.card_rewards(current_setting('points_test.nico_old'))$$,
  'the old token after a rotation gives no rewards'
);
select is_empty(
  $$select * from public.card_rewards(current_setting('points_test.lia'))$$,
  'the link of a deactivated card gives no rewards'
);
select is_empty(
  $$select * from public.card_rewards(current_setting('points_test.olga'))$$,
  'the link of a replaced card gives no rewards'
);
select is_empty(
  $$select * from public.card_rewards(current_setting('points_test.rita'))$$,
  'the link of a released card gives no rewards'
);
select is_empty(
  $$select * from public.card_rewards(current_setting('points_test.mara'))$$,
  'the link of an anonymized customer gives no rewards'
);
select is_empty(
  $$select * from public.card_rewards(current_setting('points_test.pia'))$$,
  'a surviving link of an anonymized customer still gives no rewards'
);
reset role;

-- An operator gets the same answer, nothing more.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-f000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*) from public.card_rewards(current_setting('points_test.gino'))),
  4::bigint,
  'an operator gets the same rewards'
);
select is_empty(
  $$select * from public.card_rewards(current_setting('points_test.lia'))$$,
  'and the same nothing'
);
reset role;

-- At most 100 rows, whatever the size of the catalogue.
insert into app.rewards (id, name, points, active, created_by, updated_by)
select gen_random_uuid(), 'Premio finto ' || lpad(n::text, 3, '0'), 1000 + n, true, admin.id, admin.id
from generate_series(1, 120) as n
cross join (select id from app.operators where name = 'Admin Punti') as admin;
select is(
  (select count(*) from public.card_rewards(current_setting('points_test.gino'))),
  100::bigint,
  'card_rewards gives at most 100 rewards'
);

select * from finish();
rollback;
