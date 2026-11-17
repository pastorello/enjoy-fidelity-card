-- customers: the customers table, its name key, access rules and create_customer
-- (SPEC-customers.md, "Modello dati e regole di accesso"). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

-- Fake Auth users. Ids are fixed so the test can impersonate them.
insert into auth.users (id, email) values
  ('00000000-0000-4000-c000-000000000001', 'customers.admin@example.com'),
  ('00000000-0000-4000-c000-000000000002', 'customers.operator@example.com'),
  ('00000000-0000-4000-c000-000000000003', 'customers.nobody@example.com');
select private.add_operator('customers.admin@example.com', 'Admin Clienti', 'admin');
select private.add_operator('customers.operator@example.com', 'Operatore Clienti', 'operator');

-- Returns the DETAIL of the error a statement raises, or null when it raises none.
-- Lives only inside this rolled-back transaction.
create function public.customers_test_error_detail(p_sql text)
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
grant execute on function public.customers_test_error_detail(text) to authenticated;

-- Privileges ------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'private.clean_name(text)', 'execute'),
  'authenticated cannot execute clean_name'
);
select ok(
  not has_function_privilege('anon', 'private.clean_name(text)', 'execute'),
  'anon cannot execute clean_name'
);
select ok(
  not has_function_privilege('authenticated', 'private.customer_name_key(text)', 'execute'),
  'authenticated cannot execute customer_name_key'
);
select ok(
  not has_function_privilege('anon', 'private.customer_name_key(text)', 'execute'),
  'anon cannot execute customer_name_key'
);
select ok(
  not has_function_privilege('authenticated', 'private.acting_operator_id()', 'execute'),
  'authenticated cannot execute acting_operator_id'
);
select ok(
  not has_function_privilege('anon', 'private.acting_operator_id()', 'execute'),
  'anon cannot execute acting_operator_id'
);
select ok(
  has_function_privilege('authenticated', 'app.create_customer(uuid, text, text, boolean, text)', 'execute'),
  'authenticated can execute create_customer'
);
select ok(
  not has_function_privilege('anon', 'app.create_customer(uuid, text, text, boolean, text)', 'execute'),
  'anon cannot execute create_customer'
);

-- Name key ----------------------------------------------------------------------------
select is(private.clean_name('  Nicolò   Rossi  '), 'Nicolò Rossi', 'clean_name trims and collapses spaces');
select is(private.customer_name_key('Nicolò Rossi'), 'nicolo rossi', 'the key drops accents and case');
select is(
  private.customer_name_key('nicolo  rossi'),
  private.customer_name_key('Nicolò Rossi'),
  'extra spaces do not change the key'
);
select is(
  private.customer_name_key('D’Angelo'),
  private.customer_name_key('D''Angelo'),
  'the typographic apostrophe has the same key as the straight one'
);

-- A customer row written directly by postgres, used by the reads below.
insert into app.customers (name, privacy_consent_at, created_by, create_operation_id)
values (
  'Cliente Esistente', now(),
  (select id from app.operators where name = 'Admin Clienti'),
  '00000000-0000-4000-c100-000000000000'
);

-- anon ------------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select * from app.customers$$,
  '42501',
  null,
  'anon cannot read customers'
);
reset role;

-- Signed in without an operator profile ----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000003","role":"authenticated"}', true);
select is((select count(*) from app.customers), 0::bigint, 'a user without a profile reads no customers');
select throws_ok(
  $$select app.create_customer('00000000-0000-4000-c100-000000000001', 'Maria Rossi', null, true, null)$$,
  'P0001',
  'not_operator',
  'a user without a profile cannot create a customer'
);
reset role;

-- Signed-in operator ------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000002","role":"authenticated"}', true);

select is((select count(*) from app.customers), 1::bigint, 'an active operator reads the customers');
select throws_ok(
  $$insert into app.customers (name, privacy_consent_at, created_by, create_operation_id)
    values ('Diretto', now(), (select id from app.operators limit 1), gen_random_uuid())$$,
  '42501',
  null,
  'a direct insert is denied'
);
select throws_ok(
  $$update app.customers set notes = 'x'$$,
  '42501',
  null,
  'a direct update is denied'
);
select throws_ok(
  $$delete from app.customers$$,
  '42501',
  null,
  'a direct delete is denied'
);
select throws_ok(
  $$truncate app.customers$$,
  '42501',
  null,
  'a direct truncate is denied'
);

-- Name and consent only.
select results_eq(
  $$select name, phone, notes, anonymized_at, balance, last_served_at
    from app.create_customer('00000000-0000-4000-c100-000000000001', '  Nicolò   Rossi ', null, true, null)$$,
  $$values ('Nicolò Rossi'::text, null::text, null::text, null::timestamptz, 0, null::timestamptz)$$,
  'name and consent are enough; the name is cleaned and the balance is 0'
);
reset role;
select results_eq(
  $$select created_by, privacy_consent_at from app.customers
    where create_operation_id = '00000000-0000-4000-c100-000000000001'$$,
  $$select id, now() from app.operators where name = 'Operatore Clienti'$$,
  'created_by is the calling operator and the consent time is the server''s'
);
set local role authenticated;

-- Validation.
select throws_ok(
  $$select app.create_customer(gen_random_uuid(), 'Anna Bianchi', null, false, null)$$,
  'P0001', 'consent_required', 'consent false is refused'
);
select throws_ok(
  $$select app.create_customer(gen_random_uuid(), 'Anna Bianchi', null, null, null)$$,
  'P0001', 'consent_required', 'consent null is refused'
);
select throws_ok(
  $$select app.create_customer(gen_random_uuid(), '   ', null, true, null)$$,
  'P0001', 'name_required', 'a blank name is refused'
);
select throws_ok(
  $$select app.create_customer(gen_random_uuid(), null, null, true, null)$$,
  'P0001', 'name_required', 'a null name is refused'
);
select lives_ok(
  $$select app.create_customer(gen_random_uuid(), repeat('a', 80), null, true, null)$$,
  'a name of 80 characters is accepted'
);
select throws_ok(
  $$select app.create_customer(gen_random_uuid(), repeat('b', 81), null, true, null)$$,
  'P0001', 'name_too_long', 'a name of 81 characters is refused'
);
select throws_ok(
  $$select app.create_customer(gen_random_uuid(), 'Anna Bianchi', '12', true, null)$$,
  'P0001', 'phone_invalid', 'a phone too short is refused'
);
select throws_ok(
  $$select app.create_customer(gen_random_uuid(), 'Anna Bianchi', '333 abc 4521', true, null)$$,
  'P0001', 'phone_invalid', 'a phone with letters is refused'
);
select throws_ok(
  $$select app.create_customer(gen_random_uuid(), 'Anna Bianchi', null, true, repeat('n', 501))$$,
  'P0001', 'notes_too_long', 'notes of 501 characters are refused'
);
select is(
  (select notes from app.create_customer(gen_random_uuid(), 'Note Lunghe', null, true, repeat('n', 500))),
  repeat('n', 500),
  'notes of 500 characters are accepted'
);
select results_eq(
  $$select phone, notes from app.create_customer(gen_random_uuid(), 'Solo Spazi', '   ', true, '   ')$$,
  $$values (null::text, null::text)$$,
  'a phone and notes of only spaces become null'
);

-- Phone normalization.
select is(
  (select phone from app.create_customer(gen_random_uuid(), 'Telefono Uno', '333 123 4521', true, null)),
  '+393331234521',
  '333 123 4521 becomes +393331234521'
);
select is(
  (select phone from app.create_customer(gen_random_uuid(), 'Telefono Due', '0039 333-123.4522', true, null)),
  '+393331234522',
  '0039 becomes +39 and separators are dropped'
);
select is(
  (select phone from app.create_customer(gen_random_uuid(), 'Telefono Tre', '+44 (20) 7946 0958', true, null)),
  '+442079460958',
  'a foreign number keeps its prefix'
);
select is(
  (select phone from app.create_customer(gen_random_uuid(), 'Telefono Quattro', '0771 123456', true, null)),
  '+390771123456',
  'a landline keeps its leading 0 after +39'
);

-- Unique name.
select throws_ok(
  $$select app.create_customer(gen_random_uuid(), 'nicolo  rossi', null, true, null)$$,
  'P0001', 'customer_name_taken', 'an equivalent name is refused'
);
select is(
  public.customers_test_error_detail(
    $$select app.create_customer(gen_random_uuid(), 'NICOLO ROSSI', null, true, null)$$
  ),
  (select id::text from app.customers where create_operation_id = '00000000-0000-4000-c100-000000000001'),
  'the refusal carries the existing customer id in detail'
);
select lives_ok(
  $$select app.create_customer(gen_random_uuid(), 'D''Angelo', null, true, null)$$,
  'D''Angelo is created'
);
select throws_ok(
  $$select app.create_customer(gen_random_uuid(), 'D’Angelo', null, true, null)$$,
  'P0001', 'customer_name_taken', 'D’Angelo is the same name as D''Angelo'
);

-- Idempotency.
select is(
  (select id from app.create_customer('00000000-0000-4000-c100-000000000002', 'Giulia Verdi', null, true, null)),
  (select id from app.create_customer('00000000-0000-4000-c100-000000000002', 'Giulia Verdi', null, true, null)),
  'the same operation id twice returns the same customer'
);
reset role;
select is(
  (select count(*) from app.customers where create_operation_id = '00000000-0000-4000-c100-000000000002'),
  1::bigint,
  'the same operation id twice writes one row'
);
select is(
  (select count(*) from app.customers where name_key = 'giulia verdi'),
  1::bigint,
  'the resent customer exists once'
);

-- Table constraints (written directly by postgres, bypassing the RPC).
select throws_ok(
  $$insert into app.customers (name, phone, privacy_consent_at, created_by, create_operation_id)
    values ('Telefono Grezzo', '3331234521', now(), (select id from app.operators limit 1), gen_random_uuid())$$,
  '23514', null, 'the table refuses a phone that is not E.164'
);
select throws_ok(
  $$insert into app.customers (name, privacy_consent_at, created_by, create_operation_id)
    values (' Spazi ', now(), (select id from app.operators limit 1), gen_random_uuid())$$,
  '23514', null, 'the table refuses a name that is not clean'
);
select throws_ok(
  $$insert into app.customers (name, privacy_consent_at, created_by, create_operation_id)
    values ('Giulia Verdì', now(), (select id from app.operators limit 1), gen_random_uuid())$$,
  '23505', null, 'the unique index refuses an equivalent name'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.customers'::regclass),
  'customers has row level security'
);

-- update_customer ---------------------------------------------------------------------
-- Customers used below, written directly by postgres.
insert into app.customers (id, name, phone, privacy_consent_at, notes, created_by, create_operation_id)
values
  ('00000000-0000-4000-c200-000000000001', 'Marco Neri', '+393330000001', now(), 'Caffè macchiato',
   (select id from app.operators where name = 'Operatore Clienti'), gen_random_uuid()),
  ('00000000-0000-4000-c200-000000000002', 'Già Cancellato', null, now(), null,
   (select id from app.operators where name = 'Operatore Clienti'), gen_random_uuid()),
  ('a1b2c3d4-0000-4000-c200-000000000003', 'Sara Gialli', '+393330000003', '2026-11-01 10:00+01',
   'Senza zucchero', (select id from app.operators where name = 'Operatore Clienti'), gen_random_uuid());
update app.customers set anonymized_at = now()
where id = '00000000-0000-4000-c200-000000000002';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select app.update_customer('00000000-0000-4000-c200-000000000001', 'Marco Neri', null, null)$$,
  'P0001', 'not_operator', 'a user without a profile cannot update a customer'
);
select throws_ok(
  $$select app.anonymize_customer('00000000-0000-4000-c200-000000000001')$$,
  'P0001', 'not_operator', 'a user without a profile cannot anonymize a customer'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000002","role":"authenticated"}', true);
select ok(
  has_function_privilege('authenticated', 'app.update_customer(uuid, text, text, text)', 'execute'),
  'authenticated can execute update_customer'
);
select ok(
  has_function_privilege('authenticated', 'app.anonymize_customer(uuid)', 'execute'),
  'authenticated can execute anonymize_customer'
);
select results_eq(
  $$select id, name, phone, notes, anonymized_at, balance, last_served_at
    from app.update_customer('00000000-0000-4000-c200-000000000001', ' Marco   Neri Serapo ', '333 000 0009', ' Al banco ')$$,
  $$values ('00000000-0000-4000-c200-000000000001'::uuid, 'Marco Neri Serapo'::text, '+393330000009'::text,
            'Al banco'::text, null::timestamptz, 0, null::timestamptz)$$,
  'an operator updates name, phone and notes, cleaned and normalized'
);
select results_eq(
  $$select phone, notes
    from app.update_customer('00000000-0000-4000-c200-000000000001', 'Marco Neri Serapo', '  ', '')$$,
  $$values (null::text, null::text)$$,
  'an emptied phone and notes become null'
);
select lives_ok(
  $$select app.update_customer('00000000-0000-4000-c200-000000000001', 'marco neri serapo', null, null)$$,
  'renaming a customer to its own equivalent name is allowed'
);
select throws_ok(
  $$select app.update_customer('00000000-0000-4000-c200-000000000001', 'nicolo  rossi', null, null)$$,
  'P0001', 'customer_name_taken', 'renaming to a name already used is refused'
);
select is(
  public.customers_test_error_detail(
    $$select app.update_customer('00000000-0000-4000-c200-000000000001', 'NICOLÒ ROSSI', null, null)$$
  ),
  (select id::text from app.customers where create_operation_id = '00000000-0000-4000-c100-000000000001'),
  'the rename refusal carries the other customer id in detail'
);
select throws_ok(
  $$select app.update_customer('00000000-0000-4000-c200-000000000001', '  ', null, null)$$,
  'P0001', 'name_required', 'update refuses a blank name'
);
select throws_ok(
  $$select app.update_customer('00000000-0000-4000-c200-000000000001', repeat('c', 81), null, null)$$,
  'P0001', 'name_too_long', 'update refuses a name of 81 characters'
);
select throws_ok(
  $$select app.update_customer('00000000-0000-4000-c200-000000000001', 'Marco Neri', '12', null)$$,
  'P0001', 'phone_invalid', 'update refuses an invalid phone'
);
select throws_ok(
  $$select app.update_customer('00000000-0000-4000-c200-000000000001', 'Marco Neri', null, repeat('n', 501))$$,
  'P0001', 'notes_too_long', 'update refuses notes of 501 characters'
);
select throws_ok(
  $$select app.update_customer('00000000-0000-4000-c200-0000000000ff', 'Chi Sono', null, null)$$,
  'P0001', 'customer_not_found', 'update of an unknown id is refused'
);
select throws_ok(
  $$select app.update_customer(null, 'Chi Sono', null, null)$$,
  'P0001', 'customer_not_found', 'update of a null id is refused'
);
select throws_ok(
  $$select app.update_customer('00000000-0000-4000-c200-000000000002', 'Nuovo Nome', null, null)$$,
  'P0001', 'customer_anonymized', 'update of an anonymized customer is refused'
);

-- anonymize_customer ------------------------------------------------------------------
select throws_ok(
  $$select app.anonymize_customer('a1b2c3d4-0000-4000-c200-000000000003')$$,
  'P0001', 'forbidden', 'an operator cannot anonymize a customer'
);
reset role;
select results_eq(
  $$select name, phone, notes, anonymized_at from app.customers
    where id = 'a1b2c3d4-0000-4000-c200-000000000003'$$,
  $$values ('Sara Gialli'::text, '+393330000003'::text, 'Senza zucchero'::text, null::timestamptz)$$,
  'the refused anonymization leaves the row unchanged'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select app.anonymize_customer('00000000-0000-4000-c200-0000000000ff')$$,
  'P0001', 'customer_not_found', 'anonymizing an unknown id is refused'
);
select results_eq(
  $$select id, name, phone, notes, anonymized_at, balance
    from app.anonymize_customer('a1b2c3d4-0000-4000-c200-000000000003')$$,
  $$values ('a1b2c3d4-0000-4000-c200-000000000003'::uuid, 'Cliente cancellato a1b2c3d4'::text,
            null::text, null::text, now(), 0)$$,
  'an admin anonymizes: technical name, phone and notes null, anonymized_at set'
);
reset role;
select results_eq(
  $$select name, phone, notes, anonymized_at, privacy_consent_at from app.customers
    where id = 'a1b2c3d4-0000-4000-c200-000000000003'$$,
  $$values ('Cliente cancellato a1b2c3d4'::text, null::text, null::text, now(),
            '2026-11-01 10:00+01'::timestamptz)$$,
  'the anonymized row stays, with its consent time'
);
-- A later anonymized_at would show the second call changed the row.
update app.customers set anonymized_at = '2026-11-02 12:00+01'
where id = 'a1b2c3d4-0000-4000-c200-000000000003';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$select name, anonymized_at from app.anonymize_customer('a1b2c3d4-0000-4000-c200-000000000003')$$,
  $$values ('Cliente cancellato a1b2c3d4'::text, '2026-11-02 12:00+01'::timestamptz)$$,
  'a second anonymization returns the customer unchanged'
);
reset role;
select results_eq(
  $$select name, phone, notes, anonymized_at from app.customers
    where id = 'a1b2c3d4-0000-4000-c200-000000000003'$$,
  $$values ('Cliente cancellato a1b2c3d4'::text, null::text, null::text,
            '2026-11-02 12:00+01'::timestamptz)$$,
  'a second anonymization changes nothing'
);
-- A customer already named like the technical name of another: the anonymized
-- name falls back to the full id, still unique.
insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
values
  ('b1b2c3d4-0000-4000-c200-000000000004', 'Cliente cancellato b1b2c3d4', now(),
   (select id from app.operators where name = 'Operatore Clienti'), gen_random_uuid()),
  ('b1b2c3d4-0000-4000-c200-000000000005', 'Omonimo Tecnico', now(),
   (select id from app.operators where name = 'Operatore Clienti'), gen_random_uuid());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-c000-000000000001","role":"authenticated"}', true);
select is(
  (select name from app.anonymize_customer('b1b2c3d4-0000-4000-c200-000000000005')),
  'Cliente cancellato b1b2c3d4-0000-4000-c200-000000000005',
  'a taken technical name falls back to the full id'
);
reset role;

select * from finish();
rollback;
