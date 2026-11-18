-- card links: private.card_links, private.card_token_hash, app.issue_card_link,
-- app.confirm_card_link and the rule "a deactivated card has a dead link"
-- (SPEC-cards.md, "Modello dati e regole di accesso", criteria 8, 11, 12, 15).
-- Fake data only: invented uids and names; tokens are generated inside this
-- rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(76);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-e000-000000000001', 'links.admin@example.com'),
  ('00000000-0000-4000-e000-000000000002', 'links.operator@example.com'),
  ('00000000-0000-4000-e000-000000000003', 'links.nobody@example.com');
select private.add_operator('links.admin@example.com', 'Admin Link', 'admin');
select private.add_operator('links.operator@example.com', 'Operatore Link', 'operator');

-- Fake customers: Carla (link written, then replaced), Dario (deactivated with
-- deactivate_card), Elena (anonymized), Franco (an inactive card from the start).
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
select fake.id, fake.name, now(), (select id from app.operators where name = 'Admin Link'), fake.op
from (values
  ('00000000-0000-4000-e100-000000000001'::uuid, 'Carla Link', '00000000-0000-4000-e200-000000000001'::uuid),
  ('00000000-0000-4000-e100-000000000002'::uuid, 'Dario Link', '00000000-0000-4000-e200-000000000002'::uuid),
  ('00000000-0000-4000-e100-000000000003'::uuid, 'Elena Link', '00000000-0000-4000-e200-000000000003'::uuid),
  ('00000000-0000-4000-e100-000000000004'::uuid, 'Franco Link', '00000000-0000-4000-e200-000000000004'::uuid)
) as fake (id, name, op);

insert into app.cards (id, uid, customer_id, active, associated_by, deactivated_at)
select fake.id, fake.uid, fake.customer_id, fake.active,
  (select id from app.operators where name = 'Admin Link'), fake.deactivated_at
from (values
  ('00000000-0000-4000-e300-000000000001'::uuid, '04DDEEFF000001', '00000000-0000-4000-e100-000000000001'::uuid,
   true, null::timestamptz),
  ('00000000-0000-4000-e300-000000000002'::uuid, '04DDEEFF000002', '00000000-0000-4000-e100-000000000002'::uuid,
   true, null::timestamptz),
  ('00000000-0000-4000-e300-000000000003'::uuid, '04DDEEFF000003', '00000000-0000-4000-e100-000000000003'::uuid,
   true, null::timestamptz),
  ('00000000-0000-4000-e300-000000000004'::uuid, '04DDEEFF000004', '00000000-0000-4000-e100-000000000004'::uuid,
   false, '2026-02-10 10:00+01'::timestamptz)
) as fake (id, uid, customer_id, active, deactivated_at);

-- Returns everything an error shows the caller (message, detail, hint), or
-- null when the statement raises none. Lives only inside this transaction.
create function public.links_test_error_text(p_sql text)
returns text
language plpgsql
as $$
declare
  v_message text;
  v_detail text;
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail,
    v_hint = pg_exception_hint;
  return concat_ws(' | ', nullif(v_message, ''), nullif(v_detail, ''), nullif(v_hint, ''));
end;
$$;
grant execute on function public.links_test_error_text(text) to authenticated;

-- Privileges ------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'app.issue_card_link(uuid)', 'execute'),
  'authenticated can execute issue_card_link'
);
select ok(
  not has_function_privilege('anon', 'app.issue_card_link(uuid)', 'execute'),
  'anon cannot execute issue_card_link'
);
select ok(
  has_function_privilege('authenticated', 'app.confirm_card_link(uuid, text)', 'execute'),
  'authenticated can execute confirm_card_link'
);
select ok(
  not has_function_privilege('anon', 'app.confirm_card_link(uuid, text)', 'execute'),
  'anon cannot execute confirm_card_link'
);
select ok(
  not has_function_privilege('authenticated', 'private.card_token_hash(text)', 'execute')
    and not has_function_privilege('anon', 'private.card_token_hash(text)', 'execute'),
  'nobody outside the database executes card_token_hash'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.card_links'::regclass),
  'card_links has row level security'
);
select is(
  (select count(*) from pg_policies where schemaname = 'private' and tablename = 'card_links'),
  0::bigint,
  'card_links has no policy'
);
select is(
  array(
    select r.role || ':' || p.priv
    from (values ('anon'), ('authenticated'), ('public')) r (role)
    cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'),
                       ('trigger')) p (priv)
    where r.role <> 'public' and has_table_privilege(r.role, 'private.card_links', p.priv)
    union all
    select 'public:' || acl.privilege_type
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where c.oid = 'private.card_links'::regclass and acl.grantee = 0
  ),
  array[]::text[],
  'anon, authenticated and PUBLIC have no privilege on card_links'
);
select is(
  array(
    select column_name::text from information_schema.columns
    where table_schema = 'private' and table_name = 'card_links' order by ordinal_position
  ),
  array['card_id', 'token_hash', 'pending_hash', 'pending_issued_at', 'pending_issued_by'],
  'card_links keeps only the card, the fingerprints and the pending issue'
);
select ok(
  (select bool_and(data_type = 'bytea') from information_schema.columns
   where table_schema = 'private' and table_name = 'card_links'
     and column_name in ('token_hash', 'pending_hash')),
  'the fingerprints are bytes, not text'
);
select is(
  private.card_token_hash('AAAAAAAAAAAAAAAAAAAAAA'),
  extensions.digest(convert_to('AAAAAAAAAAAAAAAAAAAAAA', 'UTF8'), 'sha256'),
  'card_token_hash is the sha256 of the token text'
);
select is(octet_length(private.card_token_hash('AAAAAAAAAAAAAAAAAAAAAA')), 32, 'a fingerprint has 32 bytes');

-- The local database keeps the links written by the E2E runs: count against what is there now.
create temporary table links_before on commit drop as
  select count(*) as n from private.card_links;

-- anon ------------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select app.issue_card_link('00000000-0000-4000-e300-000000000001')$$,
  '42501', null, 'anon cannot run issue_card_link'
);
select throws_ok(
  $$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', 'AAAAAAAAAAAAAAAAAAAAAA')$$,
  '42501', null, 'anon cannot run confirm_card_link'
);
select throws_ok($$select * from private.card_links$$, '42501', null, 'anon cannot read card_links');
reset role;

-- Signed in without an operator profile ----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select app.issue_card_link('00000000-0000-4000-e300-000000000001')$$,
  'P0001', 'not_operator', 'a user without a profile cannot issue a link'
);
select throws_ok(
  $$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', 'AAAAAAAAAAAAAAAAAAAAAA')$$,
  'P0001', 'not_operator', 'a user without a profile cannot confirm a link'
);
select throws_ok(
  $$select * from private.card_links$$, '42501', null, 'a user without a profile cannot read card_links'
);
reset role;
select is(
  (select count(*) from private.card_links), (select n from links_before),
  'the refused calls wrote nothing'
);

-- An operator signed in: direct access is refused ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000002","role":"authenticated"}', true);
select throws_ok($$select * from private.card_links$$, '42501', null, 'an operator cannot read card_links');
select throws_ok(
  $$insert into private.card_links (card_id) values ('00000000-0000-4000-e300-000000000001')$$,
  '42501', null, 'an operator cannot write card_links'
);
select throws_ok(
  $$select private.card_token_hash('AAAAAAAAAAAAAAAAAAAAAA')$$,
  '42501', null, 'an operator cannot run card_token_hash'
);

-- issue_card_link ------------------------------------------------------------------------
select set_config('links_test.t1', app.issue_card_link('00000000-0000-4000-e300-000000000001'), true);
select set_config('links_test.t2', app.issue_card_link('00000000-0000-4000-e300-000000000001'), true);
select ok(
  current_setting('links_test.t1') ~ '^[A-Za-z0-9_-]{22}$',
  'a token has 22 characters [A-Za-z0-9_-]'
);
select ok(current_setting('links_test.t2') ~ '^[A-Za-z0-9_-]{22}$', 'the second token has the same form');
select isnt(current_setting('links_test.t1'), current_setting('links_test.t2'), 'two issues give two tokens');
select results_eq(
  $$select link_written_at is null, link_written_by is null, link_pending_at is not null
    from app.cards where id = '00000000-0000-4000-e300-000000000001'$$,
  $$values (true, true, true)$$,
  'an issued link is pending, not written'
);
reset role;
select results_eq(
  $$select l.token_hash is null, l.pending_hash = private.card_token_hash(current_setting('links_test.t2')),
      l.pending_issued_by = (select id from app.operators where name = 'Operatore Link'),
      l.pending_issued_at = c.link_pending_at
    from private.card_links l join app.cards c on c.id = l.card_id
    where l.card_id = '00000000-0000-4000-e300-000000000001'$$,
  $$values (true, true, true, true)$$,
  'only the fingerprint of the last token waits; link_pending_at equals pending_issued_at'
);
select is(
  (select count(*) from private.card_links l
   where row_to_json(l)::text like '%' || current_setting('links_test.t1') || '%'
      or row_to_json(l)::text like '%' || current_setting('links_test.t2') || '%'
      or row_to_json(l)::text like '%' || encode(convert_to(current_setting('links_test.t2'), 'UTF8'), 'hex') || '%'),
  0::bigint,
  'no column of card_links holds a token in clear'
);
select is(
  (select count(*) from private.card_links
   where pending_hash = private.card_token_hash(current_setting('links_test.t1'))
      or token_hash = private.card_token_hash(current_setting('links_test.t1'))),
  0::bigint,
  'the replaced pending token is gone'
);
set local role authenticated;

select throws_ok(
  $$select app.issue_card_link('00000000-0000-4000-e300-0000000000ff')$$,
  'P0001', 'card_not_found', 'issue_card_link on a card that does not exist'
);
select throws_ok(
  $$select app.issue_card_link(null)$$, 'P0001', 'card_not_found', 'issue_card_link without a card'
);
select throws_ok(
  $$select app.issue_card_link('00000000-0000-4000-e300-000000000004')$$,
  'P0001', 'card_inactive', 'issue_card_link on a deactivated card'
);

-- confirm_card_link -----------------------------------------------------------------------
select throws_ok(
  format($$select app.confirm_card_link('00000000-0000-4000-e300-0000000000ff', %L)$$,
         current_setting('links_test.t2')),
  'P0001', 'card_not_found', 'confirm_card_link on a card that does not exist'
);
select throws_ok(
  $$select app.confirm_card_link('00000000-0000-4000-e300-000000000004', 'AAAAAAAAAAAAAAAAAAAAAA')$$,
  'P0001', 'card_inactive', 'confirm_card_link on a deactivated card'
);
select throws_ok(
  format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', %L)$$,
         current_setting('links_test.t1')),
  'P0001', 'link_token_mismatch', 'a token replaced by a newer issue is refused'
);
select is(
  strpos(
    public.links_test_error_text(
      format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', %L)$$,
             current_setting('links_test.t1'))),
    current_setting('links_test.t1')),
  0,
  'the link_token_mismatch error does not show the token'
);
select is(
  public.links_test_error_text(
    format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', %L)$$,
           current_setting('links_test.t1'))),
  'link_token_mismatch',
  'the error shows only its code: no token, fingerprint or uid'
);
select is(
  public.links_test_error_text(
    format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000004', %L)$$,
           current_setting('links_test.t2'))),
  'card_inactive',
  'card_inactive shows only its code'
);
select throws_ok(
  $$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', 'not a token')$$,
  'P0001', 'link_token_mismatch', 'a malformed token is refused'
);
select throws_ok(
  $$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', null)$$,
  'P0001', 'link_token_mismatch', 'a missing token is refused'
);
select throws_ok(
  format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000002', %L)$$,
         current_setting('links_test.t2')),
  'P0001', 'link_token_mismatch', 'the token of another card is refused'
);

select set_config(
  'links_test.r',
  (select row_to_json(r)::text
   from app.confirm_card_link('00000000-0000-4000-e300-000000000001', current_setting('links_test.t2')) r),
  true
);
select isnt(current_setting('links_test.r')::jsonb ->> 'link_written_at', null, 'the confirmation writes the link');
select is(
  (current_setting('links_test.r')::jsonb ->> 'link_written_by')::uuid,
  (select id from app.operators where name = 'Operatore Link'),
  'link_written_by is the calling operator'
);
select is(current_setting('links_test.r')::jsonb ->> 'link_pending_at', null, 'nothing is pending any more');
select is(
  (current_setting('links_test.r')::jsonb ->> 'id')::uuid,
  '00000000-0000-4000-e300-000000000001'::uuid,
  'confirm_card_link returns the card'
);
reset role;
select results_eq(
  $$select token_hash = private.card_token_hash(current_setting('links_test.t2')),
      pending_hash is null, pending_issued_at is null, pending_issued_by is null
    from private.card_links where card_id = '00000000-0000-4000-e300-000000000001'$$,
  $$values (true, true, true, true)$$,
  'the pending token becomes the valid one'
);

-- The same token again, from an admin after a lost answer: nothing changes.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000001","role":"authenticated"}', true);
select set_config(
  'links_test.r',
  (select row_to_json(r)::text
   from app.confirm_card_link('00000000-0000-4000-e300-000000000001', current_setting('links_test.t2')) r),
  true
);
select is(
  (current_setting('links_test.r')::jsonb ->> 'link_written_by')::uuid,
  (select id from app.operators where name = 'Operatore Link'),
  'confirming the same token twice changes nothing'
);
select isnt(current_setting('links_test.r')::jsonb ->> 'link_written_at', null, 'the repeat returns the written link');

-- A rewrite: the written link stays valid until the new one is confirmed.
select set_config('links_test.t3', app.issue_card_link('00000000-0000-4000-e300-000000000001'), true);
select results_eq(
  $$select link_written_at is not null, link_written_by = (select id from app.operators where name = 'Operatore Link'),
      link_pending_at is not null
    from app.cards where id = '00000000-0000-4000-e300-000000000001'$$,
  $$values (true, true, true)$$,
  'a new issue leaves the written link and marks a pending one'
);
reset role;
select results_eq(
  $$select token_hash = private.card_token_hash(current_setting('links_test.t2')),
      pending_hash = private.card_token_hash(current_setting('links_test.t3')),
      pending_issued_at = (select link_pending_at from app.cards where id = card_id),
      pending_issued_by = (select id from app.operators where name = 'Admin Link')
    from private.card_links where card_id = '00000000-0000-4000-e300-000000000001'$$,
  $$values (true, true, true, true)$$,
  'the old link stays valid while the new one waits'
);
set local role authenticated;
select lives_ok(
  format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', %L)$$,
         current_setting('links_test.t2')),
  'the valid token is still confirmed idempotently during a rewrite'
);
select is(
  (select link_pending_at is not null from app.cards where id = '00000000-0000-4000-e300-000000000001'),
  true,
  'the idempotent repeat leaves the pending link alone'
);
select is(
  (select link_written_by from app.confirm_card_link(
    '00000000-0000-4000-e300-000000000001', current_setting('links_test.t3'))),
  (select id from app.operators where name = 'Admin Link'),
  'confirming the new token writes the link again'
);
select throws_ok(
  format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', %L)$$,
         current_setting('links_test.t2')),
  'P0001', 'link_token_mismatch', 'the old valid token stops working at the rotation'
);
reset role;
select results_eq(
  $$select token_hash = private.card_token_hash(current_setting('links_test.t3')), pending_hash is null
    from private.card_links where card_id = '00000000-0000-4000-e300-000000000001'$$,
  $$values (true, true)$$,
  'the rotation keeps only the new fingerprint'
);
select results_eq(
  $$select link_pending_at is null from app.cards where id = '00000000-0000-4000-e300-000000000001'$$,
  $$values (true)$$,
  'after the rotation nothing is pending'
);

-- Any deactivation kills the link (criterion 11) -----------------------------------------
-- Dario and Elena get a written link and a pending one before their deactivation.
set local role authenticated;
select set_config('links_test.d', app.issue_card_link('00000000-0000-4000-e300-000000000002'), true);
select lives_ok(
  format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000002', %L)$$,
         current_setting('links_test.d')),
  'Dario gets a written link'
);
select lives_ok(
  $$select app.issue_card_link('00000000-0000-4000-e300-000000000002')$$, 'and a pending one'
);
select set_config('links_test.e', app.issue_card_link('00000000-0000-4000-e300-000000000003'), true);
select lives_ok(
  format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000003', %L)$$,
         current_setting('links_test.e')),
  'Elena gets a written link'
);
select lives_ok(
  $$select app.issue_card_link('00000000-0000-4000-e300-000000000003')$$, 'and a pending one'
);

-- Replacement: Carla gets a new card.
select is(
  (select replaced_card_id from app.associate_card('00000000-0000-4000-e100-000000000001', '04DDEEFF000011')),
  '00000000-0000-4000-e300-000000000001'::uuid,
  'Carla''s card is replaced'
);
select results_eq(
  $$select active, link_written_at is null, link_written_by is null, link_pending_at is null
    from app.cards where id = '00000000-0000-4000-e300-000000000001'$$,
  $$values (false, true, true, true)$$,
  'the replacement clears the link state of the old card'
);
select results_eq(
  $$select link_written_at is null, link_pending_at is null from app.cards where uid = '04DDEEFF000011'$$,
  $$values (true, true)$$,
  'the new card starts with its link not written'
);
select throws_ok(
  format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', %L)$$,
         current_setting('links_test.t3')),
  'P0001', 'card_inactive', 'the link of the replaced card cannot be confirmed'
);

-- deactivate_card: Dario.
select results_eq(
  $$select active, link_written_at is null, link_written_by is null, link_pending_at is null
    from app.deactivate_card('00000000-0000-4000-e300-000000000002')$$,
  $$values (false, true, true, true)$$,
  'deactivate_card clears the link state'
);
reset role;

-- Anonymization: Elena.
update app.customers set anonymized_at = now(), name = 'Cliente cancellato link'
where id = '00000000-0000-4000-e100-000000000003';
select results_eq(
  $$select active, link_written_at is null, link_written_by is null, link_pending_at is null
    from app.cards where id = '00000000-0000-4000-e300-000000000003'$$,
  $$values (false, true, true, true)$$,
  'the anonymization clears the link state'
);
select is(
  (select count(*) from private.card_links
   where card_id in ('00000000-0000-4000-e300-000000000001', '00000000-0000-4000-e300-000000000002',
                     '00000000-0000-4000-e300-000000000003')),
  0::bigint,
  'replacement, deactivate_card and anonymization delete the row of card_links'
);
select is(
  (select count(*) from private.card_links
   where token_hash in (private.card_token_hash(current_setting('links_test.t3')),
                        private.card_token_hash(current_setting('links_test.d')),
                        private.card_token_hash(current_setting('links_test.e')))),
  0::bigint,
  'no fingerprint of a dead link is left'
);

-- Reactivation: Carla's old card comes back with its link not written.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-e000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$select active, link_written_at is null, link_written_by is null, link_pending_at is null
    from app.associate_card('00000000-0000-4000-e100-000000000001', '04DDEEFF000001')$$,
  $$values (true, true, true, true)$$,
  'a reactivated card starts from link not written'
);
select throws_ok(
  format($$select app.confirm_card_link('00000000-0000-4000-e300-000000000001', %L)$$,
         current_setting('links_test.t3')),
  'P0001', 'link_token_mismatch', 'the old token does not come back with the reactivation'
);
select set_config('links_test.t4', app.issue_card_link('00000000-0000-4000-e300-000000000001'), true);
select is(
  (select link_written_at is not null
   from app.confirm_card_link('00000000-0000-4000-e300-000000000001', current_setting('links_test.t4'))),
  true,
  'the reactivated card gets a new link'
);
reset role;

-- Direct writes cannot bring a link back to a deactivated card.
select throws_ok(
  $$update app.cards set link_pending_at = now() where id = '00000000-0000-4000-e300-000000000002'$$,
  '23514', null, 'a deactivated card cannot have a pending link'
);
select throws_ok(
  $$insert into private.card_links (card_id, token_hash) values
    ('00000000-0000-4000-e300-000000000002', '\x00'::bytea)$$,
  '23514', null, 'a fingerprint has 32 bytes'
);
select throws_ok(
  $$insert into private.card_links (card_id, pending_hash) values
    ('00000000-0000-4000-e300-000000000002', extensions.digest('x', 'sha256'))$$,
  '23514', null, 'a pending fingerprint comes with its date and operator'
);

-- Movements and customers are untouched -----------------------------------------------------
select is(
  (select count(*) from app.customers where id in ('00000000-0000-4000-e100-000000000001',
    '00000000-0000-4000-e100-000000000002') and anonymized_at is null),
  2::bigint,
  'the link RPCs leave the customers alone'
);

-- Seed --------------------------------------------------------------------------------------
select is(
  (select count(*) from private.card_links l join app.cards c on c.id = l.card_id
   where c.uid = '04AABBCCDDEE01'),
  0::bigint,
  'the seed card has no link'
);

select * from finish();
rollback;
