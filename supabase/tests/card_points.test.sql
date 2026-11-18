-- public.card_points, the only function anyone without an account may run, and
-- the allowlist of what anon can execute (SPEC-cards.md, "Modello dati e regole
-- di accesso", criteria 8, 11, 12). Fake data only: invented uids and names;
-- tokens are generated inside this rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-f000-000000000001', 'points.admin@example.com'),
  ('00000000-0000-4000-f000-000000000002', 'points.operator@example.com');
select private.add_operator('points.admin@example.com', 'Admin Punti', 'admin');
select private.add_operator('points.operator@example.com', 'Operatore Punti', 'operator');

-- Fake customers, one per case: Gino (link confirmed), Ivo (link only pending),
-- Lia (card deactivated), Mara (anonymized), Nico (link rotated), Olga (card
-- replaced), Pia (anonymized without the trigger: the clause on anonymized_at).
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
select fake.id, fake.name, now(), (select id from app.operators where name = 'Admin Punti'), fake.op
from (values
  ('00000000-0000-4000-f100-000000000001'::uuid, 'Gino Punti', '00000000-0000-4000-f200-000000000001'::uuid),
  ('00000000-0000-4000-f100-000000000002'::uuid, 'Ivo Punti', '00000000-0000-4000-f200-000000000002'::uuid),
  ('00000000-0000-4000-f100-000000000003'::uuid, 'Lia Punti', '00000000-0000-4000-f200-000000000003'::uuid),
  ('00000000-0000-4000-f100-000000000004'::uuid, 'Mara Punti', '00000000-0000-4000-f200-000000000004'::uuid),
  ('00000000-0000-4000-f100-000000000005'::uuid, 'Nico Punti', '00000000-0000-4000-f200-000000000005'::uuid),
  ('00000000-0000-4000-f100-000000000006'::uuid, 'Olga Punti', '00000000-0000-4000-f200-000000000006'::uuid),
  ('00000000-0000-4000-f100-000000000007'::uuid, 'Pia Punti', '00000000-0000-4000-f200-000000000007'::uuid)
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
  ('00000000-0000-4000-f300-000000000007'::uuid, '04EEFF00000007', '00000000-0000-4000-f100-000000000007'::uuid)
) as fake (id, uid, customer_id);

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
  array['card_points(text)'],
  'in public anon executes exactly card_points(text)'
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

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-f000-000000000001","role":"authenticated"}', true);
select app.anonymize_customer('00000000-0000-4000-f100-000000000004');
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

select * from finish();
rollback;
