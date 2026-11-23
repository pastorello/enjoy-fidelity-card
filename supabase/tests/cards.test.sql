-- cards: the cards table, its uid rule, access rules, triggers and the RPCs
-- lookup_card, associate_card and deactivate_card (SPEC-cards.md, "Modello dati
-- e regole di accesso"). Fake data only: invented uids and names.
begin;
create extension if not exists pgtap with schema extensions;
select plan(125);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-d000-000000000001', 'cards.admin@example.com'),
  ('00000000-0000-4000-d000-000000000002', 'cards.operator@example.com'),
  ('00000000-0000-4000-d000-000000000003', 'cards.nobody@example.com');
select private.add_operator('cards.admin@example.com', 'Admin Card', 'admin');
select private.add_operator('cards.operator@example.com', 'Operatore Card', 'operator');

-- Fake customers: Maria and Antonio get cards, Rita is anonymized, Teresa has a
-- deactivated card to reactivate.
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
select fake.id, fake.name, now(), (select id from app.operators where name = 'Admin Card'), fake.op
from (values
  ('00000000-0000-4000-d100-000000000001'::uuid, 'Maria Carte', '00000000-0000-4000-d200-000000000001'::uuid),
  ('00000000-0000-4000-d100-000000000002'::uuid, 'Antonio Carte', '00000000-0000-4000-d200-000000000002'::uuid),
  ('00000000-0000-4000-d100-000000000003'::uuid, 'Rita Carte', '00000000-0000-4000-d200-000000000003'::uuid),
  ('00000000-0000-4000-d100-000000000004'::uuid, 'Teresa Carte', '00000000-0000-4000-d200-000000000004'::uuid)
) as fake (id, name, op);

-- Rita's card, then Rita anonymized: the anonymization trigger deactivates the card.
insert into app.cards (id, uid, customer_id, associated_by)
values (
  '00000000-0000-4000-d300-000000000003', '04CCDDEEFF0003', '00000000-0000-4000-d100-000000000003',
  (select id from app.operators where name = 'Admin Card')
);
update app.customers
set name = 'Cliente cancellato prova', anonymized_at = now()
where id = '00000000-0000-4000-d100-000000000003';

-- Teresa: an old deactivated card and an active one.
insert into app.cards (id, uid, customer_id, active, associated_at, associated_by, deactivated_at)
values
  ('00000000-0000-4000-d300-000000000041', '04CCDDEEFF0041', '00000000-0000-4000-d100-000000000004',
   false, '2026-01-10 10:00+01', (select id from app.operators where name = 'Admin Card'),
   '2026-02-10 10:00+01'),
  ('00000000-0000-4000-d300-000000000042', '04CCDDEEFF0042', '00000000-0000-4000-d100-000000000004',
   true, '2026-02-10 10:00+01', (select id from app.operators where name = 'Admin Card'), null);

-- Returns the DETAIL of the error a statement raises, or null when it raises none.
-- Lives only inside this rolled-back transaction.
create function public.cards_test_error_detail(p_sql text)
returns text
language plpgsql
as $$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
grant execute on function public.cards_test_error_detail(text) to authenticated;

-- Privileges ------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'app.lookup_card(text)', 'execute'),
  'authenticated can execute lookup_card'
);
select ok(
  not has_function_privilege('anon', 'app.lookup_card(text)', 'execute'),
  'anon cannot execute lookup_card'
);
select ok(
  has_function_privilege('authenticated', 'app.associate_card(uuid, text)', 'execute'),
  'authenticated can execute associate_card'
);
select ok(
  not has_function_privilege('anon', 'app.associate_card(uuid, text)', 'execute'),
  'anon cannot execute associate_card'
);
select ok(
  has_function_privilege('authenticated', 'app.deactivate_card(uuid)', 'execute'),
  'authenticated can execute deactivate_card'
);
select ok(
  not has_function_privilege('anon', 'app.deactivate_card(uuid)', 'execute'),
  'anon cannot execute deactivate_card'
);
select ok(
  not has_function_privilege('authenticated', 'private.is_card_uid(text)', 'execute'),
  'authenticated cannot execute is_card_uid'
);
select ok(
  not has_function_privilege('anon', 'private.is_card_uid(text)', 'execute'),
  'anon cannot execute is_card_uid'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.cards'::regclass),
  'cards has row level security on'
);
select ok(
  not has_table_privilege('authenticated', 'app.cards', 'insert')
    and not has_table_privilege('authenticated', 'app.cards', 'update')
    and not has_table_privilege('authenticated', 'app.cards', 'delete')
    and not has_table_privilege('authenticated', 'app.cards', 'truncate'),
  'authenticated has no write privilege on cards'
);

-- uid rule (as in normalizeUid: upper-case hex, no separators, 4 to 10 bytes) -----
select throws_ok(
  $$insert into app.cards (uid, customer_id, associated_by)
    values ('04ccddeeff0099', '00000000-0000-4000-d100-000000000002', (select id from app.operators limit 1))$$,
  '23514', null, 'a lower-case uid is rejected'
);
select throws_ok(
  $$insert into app.cards (uid, customer_id, associated_by)
    values ('04:CC:DD:EE:FF:00:99', '00000000-0000-4000-d100-000000000002', (select id from app.operators limit 1))$$,
  '23514', null, 'a uid with separators is rejected'
);
select throws_ok(
  $$insert into app.cards (uid, customer_id, associated_by)
    values ('04CCDDEEFF009', '00000000-0000-4000-d100-000000000002', (select id from app.operators limit 1))$$,
  '23514', null, 'a uid with an odd number of digits is rejected'
);
select throws_ok(
  $$insert into app.cards (uid, customer_id, associated_by)
    values ('04CCDD', '00000000-0000-4000-d100-000000000002', (select id from app.operators limit 1))$$,
  '23514', null, 'a 3-byte uid is rejected'
);
select throws_ok(
  $$insert into app.cards (uid, customer_id, associated_by)
    values ('04CCDDEEFF00FF00112233', '00000000-0000-4000-d100-000000000002', (select id from app.operators limit 1))$$,
  '23514', null, 'an 11-byte uid is rejected'
);
select throws_ok(
  $$insert into app.cards (uid, customer_id, associated_by)
    values ('00000000000000', '00000000-0000-4000-d100-000000000002', (select id from app.operators limit 1))$$,
  '23514', null, 'an all-zero uid is rejected'
);
select is(private.is_card_uid('04CCDDEEFF0099'), true, 'a 7-byte uid is valid');
select is(private.is_card_uid('04CCDDEE'), true, 'a 4-byte uid is valid');
select is(private.is_card_uid('04CCDDEEFF00FF001122'), true, 'a 10-byte uid is valid');
select is(private.is_card_uid(null), false, 'a null uid is not valid');

-- Triggers --------------------------------------------------------------------------
select throws_ok(
  $$update app.cards set uid = '04CCDDEEFF0099' where id = '00000000-0000-4000-d300-000000000042'$$,
  '55000', null, 'the uid of a card never changes'
);
select throws_ok(
  $$update app.cards set customer_id = '00000000-0000-4000-d100-000000000002'
    where id = '00000000-0000-4000-d300-000000000042'$$,
  '55000', null, 'the customer of a card never changes'
);
select throws_ok(
  $$update app.cards set associated_by = (select id from app.operators where name = 'Operatore Card')
    where id = '00000000-0000-4000-d300-000000000042'$$,
  '55000', null, 'associated_by changes only on reactivation'
);
select throws_ok(
  $$update app.cards set associated_at = now() where id = '00000000-0000-4000-d300-000000000042'$$,
  '55000', null, 'associated_at changes only on reactivation'
);
select throws_ok(
  $$update app.cards set associated_at = now(), active = false, deactivated_at = now()
    where id = '00000000-0000-4000-d300-000000000042'$$,
  '55000', null, 'a deactivation cannot change associated_at'
);
select throws_ok(
  $$delete from app.cards where id = '00000000-0000-4000-d300-000000000041'$$,
  '55000', null, 'cards are never deleted'
);
select throws_ok(
  $$update app.cards set active = false where id = '00000000-0000-4000-d300-000000000042'$$,
  '23514', null, 'an inactive card must have deactivated_at'
);
select throws_ok(
  $$insert into app.cards (uid, customer_id, associated_by)
    values ('04CCDDEEFF0043', '00000000-0000-4000-d100-000000000004', (select id from app.operators limit 1))$$,
  '23505', null, 'a customer cannot have two active cards'
);

-- anon ------------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from app.cards$$, '42501', null, 'anon cannot read cards');
select throws_ok(
  $$select * from app.lookup_card('04CCDDEEFF0042')$$, '42501', null, 'anon cannot run lookup_card'
);
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-000000000001', '04CCDDEEFF0001')$$,
  '42501', null, 'anon cannot run associate_card'
);
select throws_ok(
  $$select * from app.deactivate_card('00000000-0000-4000-d300-000000000042')$$,
  '42501', null, 'anon cannot run deactivate_card'
);
reset role;

-- Signed in without an operator profile ----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000003","role":"authenticated"}', true);
select is((select count(*) from app.cards), 0::bigint, 'a user without a profile reads no cards');
select throws_ok(
  $$select * from app.lookup_card('04CCDDEEFF0042')$$,
  'P0001', 'not_operator', 'a user without a profile cannot look up a card'
);
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-000000000001', '04CCDDEEFF0001')$$,
  'P0001', 'not_operator', 'a user without a profile cannot associate a card'
);
select throws_ok(
  $$select * from app.deactivate_card('00000000-0000-4000-d300-000000000042')$$,
  'P0001', 'not_operator', 'a user without a profile cannot deactivate a card'
);
reset role;

-- Signed-in operator: direct access --------------------------------------------------
select set_config('cards_test.total', (select count(*) from app.cards)::text, true);
select set_config('cards_test.customers', (select md5(string_agg(c::text, ',' order by c.id)) from app.customers c), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*) from app.cards),
  current_setting('cards_test.total')::bigint,
  'an active operator reads every card'
);
select throws_ok(
  $$insert into app.cards (uid, customer_id, associated_by)
    values ('04CCDDEEFF0098', '00000000-0000-4000-d100-000000000002', (select id from app.operators limit 1))$$,
  '42501', null, 'an operator cannot insert a card directly'
);
select throws_ok(
  $$update app.cards set active = false, deactivated_at = now() where id = '00000000-0000-4000-d300-000000000042'$$,
  '42501', null, 'an operator cannot update a card directly'
);
select throws_ok(
  $$delete from app.cards where id = '00000000-0000-4000-d300-000000000041'$$,
  '42501', null, 'an operator cannot delete a card directly'
);

-- associate_card: first card -----------------------------------------------------------
select set_config(
  'cards_test.r',
  (select row_to_json(r)::text
   from app.associate_card('00000000-0000-4000-d100-000000000001', '04CCDDEEFF0001') r),
  true
);
select is(current_setting('cards_test.r')::jsonb ->> 'uid', '04CCDDEEFF0001', 'associate_card returns the card');
select is(
  (current_setting('cards_test.r')::jsonb ->> 'customer_id')::uuid,
  '00000000-0000-4000-d100-000000000001'::uuid,
  'the card belongs to the customer'
);
select is((current_setting('cards_test.r')::jsonb ->> 'active')::boolean, true, 'the new card is active');
select is(
  (current_setting('cards_test.r')::jsonb ->> 'associated_by')::uuid,
  (select id from app.operators where name = 'Operatore Card'),
  'associated_by is the calling operator'
);
select is(current_setting('cards_test.r')::jsonb ->> 'replaced_card_id', null, 'no card was replaced');
select is(
  current_setting('cards_test.r')::jsonb ->> 'link_written_at', null, 'the link of a new card is not written'
);
select set_config('cards_test.card1', current_setting('cards_test.r')::jsonb ->> 'id', true);

-- Repeated after a lost answer: nothing changes.
select set_config(
  'cards_test.r',
  (select row_to_json(r)::text
   from app.associate_card('00000000-0000-4000-d100-000000000001', '04CCDDEEFF0001') r),
  true
);
select is(
  current_setting('cards_test.r')::jsonb ->> 'id', current_setting('cards_test.card1'),
  'repeating associate_card returns the same card'
);
select is(current_setting('cards_test.r')::jsonb ->> 'replaced_card_id', null, 'the repeat replaces nothing');
select is(
  (select count(*) from app.cards where customer_id = '00000000-0000-4000-d100-000000000001'),
  1::bigint,
  'the repeat creates no other card'
);

-- lookup_card ---------------------------------------------------------------------------
select is(
  (select count(*) from app.lookup_card('04CCDDEEFF0077')), 0::bigint, 'an unknown card gives no row'
);
select results_eq(
  $$select card_id, customer_id, customer_name, active, customer_anonymized
    from app.lookup_card('04CCDDEEFF0001')$$,
  $$values (current_setting('cards_test.card1')::uuid, '00000000-0000-4000-d100-000000000001'::uuid,
            'Maria Carte'::text, true, false)$$,
  'an active card gives its customer'
);
select results_eq(
  $$select card_id, customer_name, active, customer_anonymized from app.lookup_card('04CCDDEEFF0041')$$,
  $$values ('00000000-0000-4000-d300-000000000041'::uuid, 'Teresa Carte'::text, false, false)$$,
  'a deactivated card gives its customer and active false'
);
select results_eq(
  $$select card_id, customer_id, customer_name, customer_anonymized from app.lookup_card('04CCDDEEFF0003')$$,
  $$values ('00000000-0000-4000-d300-000000000003'::uuid, '00000000-0000-4000-d100-000000000003'::uuid,
            null::text, true)$$,
  'the card of an anonymized customer gives no name'
);
select throws_ok(
  $$select * from app.lookup_card('04ccddeeff0001')$$, 'P0001', 'invalid_uid', 'lookup_card rejects a lower-case uid'
);
select throws_ok(
  $$select * from app.lookup_card(null)$$, 'P0001', 'invalid_uid', 'lookup_card rejects a null uid'
);

-- associate_card: replacement by an admin ------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000001","role":"authenticated"}', true);
select set_config(
  'cards_test.r',
  (select row_to_json(r)::text
   from app.associate_card('00000000-0000-4000-d100-000000000001', '04CCDDEEFF0002') r),
  true
);
select set_config('cards_test.card2', current_setting('cards_test.r')::jsonb ->> 'id', true);
select is(current_setting('cards_test.r')::jsonb ->> 'uid', '04CCDDEEFF0002', 'the replacement returns the new card');
select is((current_setting('cards_test.r')::jsonb ->> 'active')::boolean, true, 'the new card is active');
select is(
  current_setting('cards_test.r')::jsonb ->> 'replaced_card_id', current_setting('cards_test.card1'),
  'replaced_card_id is the old card'
);
select is(
  (current_setting('cards_test.r')::jsonb ->> 'associated_by')::uuid,
  (select id from app.operators where name = 'Admin Card'),
  'associated_by is the calling admin'
);
select is(
  (select active from app.cards where id = current_setting('cards_test.card1')::uuid),
  false,
  'the old card is no longer active'
);
select isnt(
  (select deactivated_at from app.cards where id = current_setting('cards_test.card1')::uuid),
  null,
  'the old card has deactivated_at'
);
select is(
  (select count(*) from app.cards where customer_id = '00000000-0000-4000-d100-000000000001' and active),
  1::bigint,
  'the customer has one active card'
);

-- card_taken ---------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-000000000002', '04CCDDEEFF0002')$$,
  'P0001', 'card_taken', 'the active card of another customer is taken'
);
select is(
  public.cards_test_error_detail(
    $$select * from app.associate_card('00000000-0000-4000-d100-000000000002', '04CCDDEEFF0002')$$
  )::jsonb,
  jsonb_build_object('owner_id', '00000000-0000-4000-d100-000000000001', 'owner_name', 'Maria Carte', 'active', true),
  'card_taken says who owns the active card'
);
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-000000000002', '04CCDDEEFF0001')$$,
  'P0001', 'card_taken', 'a deactivated card of another customer is taken too'
);
select is(
  public.cards_test_error_detail(
    $$select * from app.associate_card('00000000-0000-4000-d100-000000000002', '04CCDDEEFF0001')$$
  )::jsonb,
  jsonb_build_object('owner_id', '00000000-0000-4000-d100-000000000001', 'owner_name', 'Maria Carte', 'active', false),
  'card_taken says the card is deactivated'
);
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-000000000002', '04CCDDEEFF0003')$$,
  'P0001', 'card_taken', 'the card of an anonymized customer is taken'
);
select is(
  public.cards_test_error_detail(
    $$select * from app.associate_card('00000000-0000-4000-d100-000000000002', '04CCDDEEFF0003')$$
  )::jsonb,
  jsonb_build_object('owner_id', '00000000-0000-4000-d100-000000000003', 'owner_name', null, 'active', false),
  'card_taken gives no name for an anonymized owner'
);
select is(
  (select count(*) from app.cards where customer_id = '00000000-0000-4000-d100-000000000002'),
  0::bigint,
  'a taken card leaves the customer without cards'
);

-- Other errors -----------------------------------------------------------------------------------
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-0000000000ff', '04CCDDEEFF0005')$$,
  'P0001', 'customer_not_found', 'associate_card on a customer that does not exist'
);
select throws_ok(
  $$select * from app.associate_card(null, '04CCDDEEFF0005')$$,
  'P0001', 'customer_not_found', 'associate_card without a customer'
);
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-000000000003', '04CCDDEEFF0005')$$,
  'P0001', 'customer_anonymized', 'associate_card on an anonymized customer'
);
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-000000000002', '04:CC:DD:EE:FF:00:05')$$,
  'P0001', 'invalid_uid', 'associate_card rejects a uid with separators'
);
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-000000000002', '04CCDDEEFF00FF00112233')$$,
  'P0001', 'invalid_uid', 'associate_card rejects an 11-byte uid'
);
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-000000000002', null)$$,
  'P0001', 'invalid_uid', 'associate_card rejects a null uid'
);

-- Reactivation of the customer's own deactivated card -------------------------------------------
-- Only an admin reactivates (SPEC-customers-v2.md, criterion 11): the admin does it here.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000001","role":"authenticated"}', true);
select set_config(
  'cards_test.r',
  (select row_to_json(r)::text
   from app.associate_card('00000000-0000-4000-d100-000000000004', '04CCDDEEFF0041') r),
  true
);
select is(
  current_setting('cards_test.r')::jsonb ->> 'id', '00000000-0000-4000-d300-000000000041',
  'the reactivation returns the old card'
);
select is((current_setting('cards_test.r')::jsonb ->> 'active')::boolean, true, 'the old card is active again');
select is(
  current_setting('cards_test.r')::jsonb ->> 'deactivated_at', null, 'the reactivated card has no deactivated_at'
);
select is(
  (current_setting('cards_test.r')::jsonb ->> 'associated_at')::timestamptz, now(),
  'the reactivation updates associated_at'
);
select is(
  (current_setting('cards_test.r')::jsonb ->> 'associated_by')::uuid,
  (select id from app.operators where name = 'Admin Card'),
  'the reactivation records who reactivated'
);
select is(
  current_setting('cards_test.r')::jsonb ->> 'replaced_card_id', '00000000-0000-4000-d300-000000000042',
  'the reactivation replaces the other active card'
);
select is(
  (select active from app.cards where id = '00000000-0000-4000-d300-000000000042'),
  false,
  'the other card is deactivated'
);
select is(
  (select count(*) from app.cards where customer_id = '00000000-0000-4000-d100-000000000004' and active),
  1::bigint,
  'after the reactivation the customer has one active card'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000002","role":"authenticated"}', true);

-- deactivate_card --------------------------------------------------------------------------------
select set_config(
  'cards_test.r',
  (select row_to_json(r)::text from app.deactivate_card(current_setting('cards_test.card2')::uuid) r),
  true
);
select is((current_setting('cards_test.r')::jsonb ->> 'active')::boolean, false, 'deactivate_card deactivates');
select isnt(current_setting('cards_test.r')::jsonb ->> 'deactivated_at', null, 'deactivate_card sets deactivated_at');
select is(
  (select count(*) from app.cards where customer_id = '00000000-0000-4000-d100-000000000001' and active),
  0::bigint,
  'the customer has no active card'
);
select set_config('cards_test.deactivated_at', current_setting('cards_test.r')::jsonb ->> 'deactivated_at', true);
select set_config(
  'cards_test.r',
  (select row_to_json(r)::text from app.deactivate_card(current_setting('cards_test.card2')::uuid) r),
  true
);
select is(
  current_setting('cards_test.r')::jsonb ->> 'deactivated_at', current_setting('cards_test.deactivated_at'),
  'repeating deactivate_card changes nothing'
);
select is((current_setting('cards_test.r')::jsonb ->> 'active')::boolean, false, 'the repeat returns the card');
select throws_ok(
  $$select * from app.deactivate_card('00000000-0000-4000-d300-0000000000ff')$$,
  'P0001', 'card_not_found', 'deactivate_card on a card that does not exist'
);
select throws_ok(
  $$select * from app.deactivate_card(null)$$,
  'P0001', 'card_not_found', 'deactivate_card without a card'
);

-- A deactivated card of the same customer can be associated again later, by an admin only
-- (SPEC-customers-v2.md, criterion 11).
select throws_ok(
  $$select * from app.associate_card('00000000-0000-4000-d100-000000000001', '04CCDDEEFF0001')$$,
  'P0001', 'forbidden', 'an operator cannot get an old card back'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000001","role":"authenticated"}', true);
select is(
  (select active from app.associate_card('00000000-0000-4000-d100-000000000001', '04CCDDEEFF0001')),
  true,
  'a customer without an active card gets an old card back'
);
select is(
  (select replaced_card_id from app.associate_card('00000000-0000-4000-d100-000000000001', '04CCDDEEFF0001')),
  null,
  'nothing to replace when the card is already active'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000002","role":"authenticated"}', true);

-- associate_card for a customer without cards; the 7-byte uid is accepted.
select is(
  (select uid from app.associate_card('00000000-0000-4000-d100-000000000002', '04CCDDEEFF0009')),
  '04CCDDEEFF0009',
  'an operator associates a card to a customer without cards'
);
select is(
  (select uid from app.associate_card('00000000-0000-4000-d100-000000000002', '04CCDDEE')),
  '04CCDDEE',
  'a 4-byte uid is accepted'
);
reset role;

-- Nothing outside app.cards changed ---------------------------------------------------------------
select is(
  (select md5(string_agg(c::text, ',' order by c.id)) from app.customers c),
  current_setting('cards_test.customers'),
  'associating, replacing and deactivating cards change no customer row'
);
select is(
  (select count(*) from app.cards where uid = '04CCDDEEFF0009' and associated_by = (select id from app.operators where name = 'Operatore Card')),
  1::bigint,
  'the card is recorded with the operator who associated it'
);

-- create_customer_with_card ----------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'app.create_customer_with_card(uuid, text, text, boolean, text, text)', 'execute'),
  'authenticated can execute create_customer_with_card'
);
select ok(
  not has_function_privilege('anon', 'app.create_customer_with_card(uuid, text, text, boolean, text, text)', 'execute'),
  'anon cannot execute create_customer_with_card'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select * from app.create_customer_with_card('00000000-0000-4000-d400-000000000009', 'Ospite Carte', null, true, null, '04CCDDEEFF0109')$$,
  'P0001', 'not_operator', 'a user without a profile cannot create a customer with a card'
);
reset role;
select is(
  (select count(*) from app.customers where create_operation_id = '00000000-0000-4000-d400-000000000009'),
  0::bigint,
  'a refused caller creates no customer'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$select name, email, anonymized_at
    from app.create_customer_with_card('00000000-0000-4000-d400-000000000001', '  Nuova  Carte ', null, true, null, '04CCDDEEFF0101')$$,
  $$values ('Nuova Carte'::text, null::text, null::timestamptz)$$,
  'create_customer_with_card creates the customer with the rules of create_customer'
);
select results_eq(
  $$select c.active, c.associated_by = (select id from app.operators where name = 'Operatore Card'),
           c.link_written_at is null, c.link_pending_at is null
    from app.cards c join app.customers cu on cu.id = c.customer_id
    where c.uid = '04CCDDEEFF0101' and cu.create_operation_id = '00000000-0000-4000-d400-000000000001'$$,
  $$values (true, true, true, true)$$,
  'the new customer gets the card, active, associated by the caller, link not written'
);
select is(
  (select id from app.create_customer_with_card('00000000-0000-4000-d400-000000000001', 'Nuova Carte', null, true, null, '04CCDDEEFF0101')),
  (select id from app.customers where create_operation_id = '00000000-0000-4000-d400-000000000001'),
  'the same operation_id again returns the same customer'
);
select is(
  (select id from app.create_customer_with_card('00000000-0000-4000-d400-000000000001', 'Altro Nome', null, true, null, '04CCDDEEFF0102')),
  (select id from app.customers where create_operation_id = '00000000-0000-4000-d400-000000000001'),
  'a resent operation_id returns the first customer whatever the arguments'
);
select results_eq(
  $$select
      (select count(*) from app.customers where name in ('Nuova Carte', 'Altro Nome')),
      (select count(*) from app.cards c join app.customers cu on cu.id = c.customer_id
        where cu.create_operation_id = '00000000-0000-4000-d400-000000000001'),
      (select count(*) from app.cards where uid = '04CCDDEEFF0102')$$,
  $$values (1::bigint, 1::bigint, 0::bigint)$$,
  'a resent operation_id leaves one customer and one card and touches no card'
);

-- All or nothing.
select throws_ok(
  $$select * from app.create_customer_with_card('00000000-0000-4000-d400-000000000002', 'Bruno Carte', null, true, null, '04CCDDEEFF0042')$$,
  'P0001', 'card_taken', 'a card of another customer is taken'
);
select is(
  public.cards_test_error_detail(
    $$select * from app.create_customer_with_card('00000000-0000-4000-d400-000000000002', 'Bruno Carte', null, true, null, '04CCDDEEFF0003')$$
  )::jsonb,
  jsonb_build_object('owner_id', '00000000-0000-4000-d100-000000000003', 'owner_name', null, 'active', false),
  'card_taken has the same detail as associate_card'
);
select throws_ok(
  $$select * from app.create_customer_with_card('00000000-0000-4000-d400-000000000002', 'Bruno Carte', null, true, null, '04ccddeeff0103')$$,
  'P0001', 'invalid_uid', 'a lower-case uid is invalid'
);
select throws_ok(
  $$select * from app.create_customer_with_card('00000000-0000-4000-d400-000000000002', 'Bruno Carte', null, true, null, null)$$,
  'P0001', 'invalid_uid', 'a missing uid is invalid'
);
select throws_ok(
  $$select * from app.create_customer_with_card('00000000-0000-4000-d400-000000000002', 'maria  carte', null, true, null, '04CCDDEEFF0104')$$,
  'P0001', 'customer_name_taken', 'a name already used is refused'
);
select throws_ok(
  $$select * from app.create_customer_with_card('00000000-0000-4000-d400-000000000002', 'Bruno Carte', null, false, null, '04CCDDEEFF0104')$$,
  'P0001', 'consent_required', 'the privacy consent is required'
);
select results_eq(
  $$select
      (select count(*) from app.customers
        where name = 'Bruno Carte' or create_operation_id = '00000000-0000-4000-d400-000000000002'),
      (select count(*) from app.cards where uid in ('04CCDDEEFF0103', '04CCDDEEFF0104')),
      (select count(*) from app.cards where uid = '04CCDDEEFF0042' and customer_id = '00000000-0000-4000-d100-000000000004')$$,
  $$values (0::bigint, 0::bigint, 1::bigint)$$,
  'card_taken, invalid_uid and the customer errors leave neither customer nor card'
);
select is(
  (select name from app.create_customer_with_card('00000000-0000-4000-d400-000000000002', 'Bruno Carte', null, true, null, '04CCDDEEFF0105')),
  'Bruno Carte',
  'after a failure the same operation_id still creates the customer and the card'
);
select is(
  (select cu.name from app.cards c join app.customers cu on cu.id = c.customer_id where c.uid = '04CCDDEEFF0105' and c.active),
  'Bruno Carte',
  'the retried creation has its card'
);
reset role;

-- Anonymization deactivates the card --------------------------------------------------------------
select is(
  (select count(*) from app.cards c join app.customers cu on cu.id = c.customer_id
    where cu.anonymized_at is not null and c.active),
  0::bigint,
  'no anonymized customer has an active card'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-d000-000000000001","role":"authenticated"}', true);
select isnt(
  (select anonymized_at from app.anonymize_customer(
    (select id from app.customers where create_operation_id = '00000000-0000-4000-d400-000000000001'))),
  null,
  'an admin anonymizes the customer created with a card'
);
select results_eq(
  $$select active, deactivated_at is not null, link_written_at is null, link_pending_at is null
    from app.cards where uid = '04CCDDEEFF0101'$$,
  $$values (false, true, true, true)$$,
  'the anonymization deactivates the active card'
);
select results_eq(
  $$select customer_id, customer_name, active, customer_anonymized from app.lookup_card('04CCDDEEFF0101')$$,
  $$select id, null::text, false, true from app.customers
    where create_operation_id = '00000000-0000-4000-d400-000000000001'$$,
  'the uid stays bound to the anonymized customer'
);
select is(
  public.cards_test_error_detail(
    $$select * from app.associate_card('00000000-0000-4000-d100-000000000002', '04CCDDEEFF0101')$$
  )::jsonb,
  jsonb_build_object(
    'owner_id', (select id from app.customers where create_operation_id = '00000000-0000-4000-d400-000000000001'),
    'owner_name', null,
    'active', false
  ),
  'associating the uid to another customer gives card_taken without a name'
);
select set_config(
  'cards_test.deactivated_at',
  (select deactivated_at from app.cards where uid = '04CCDDEEFF0101')::text,
  true
);
select lives_ok(
  $$select app.anonymize_customer(
    (select id from app.customers where create_operation_id = '00000000-0000-4000-d400-000000000001'))$$,
  'anonymizing again is accepted'
);
select is(
  (select deactivated_at from app.cards where uid = '04CCDDEEFF0101'),
  current_setting('cards_test.deactivated_at')::timestamptz,
  'anonymizing again changes no card'
);
reset role;

-- Bruno: only the active card is deactivated, an old one keeps its date; any
-- path that sets anonymized_at fires the trigger, not only anonymize_customer.
insert into app.cards (uid, customer_id, active, associated_at, associated_by, deactivated_at)
select '04CCDDEEFF0106', id, false, '2026-01-10 10:00+01',
  (select id from app.operators where name = 'Admin Card'), '2026-02-10 10:00+01'
from app.customers where create_operation_id = '00000000-0000-4000-d400-000000000002';
update app.customers set anonymized_at = now()
where create_operation_id = '00000000-0000-4000-d400-000000000002';
select results_eq(
  $$select c.uid, c.active, c.deactivated_at = '2026-02-10 10:00+01'
    from app.cards c join app.customers cu on cu.id = c.customer_id
    where cu.create_operation_id = '00000000-0000-4000-d400-000000000002' order by c.uid$$,
  $$values ('04CCDDEEFF0105'::text, false, false), ('04CCDDEEFF0106'::text, false, true)$$,
  'only the active card of the anonymized customer is deactivated'
);
select is(
  (select count(*) from app.cards c join app.customers cu on cu.id = c.customer_id
    where cu.anonymized_at is not null and c.active),
  0::bigint,
  'after the anonymizations no anonymized customer has an active card'
);

-- Seed --------------------------------------------------------------------------------------------
select results_eq(
  $$select cu.name, c.active, c.link_written_at is null, c.link_pending_at is null
    from app.cards c join app.customers cu on cu.id = c.customer_id
    where c.uid = '04AABBCCDDEE01'$$,
  $$values ('Anna Ferrari'::text, true, true, true)$$,
  'the seed has one fake active card with its link not written'
);

select * from finish();
rollback;
