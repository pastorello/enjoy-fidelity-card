-- Development seed. Fake data only: this repository is public, never put real
-- customer data here.

-- Fake accounts for local development, E2E and integration tests.
-- Password for all: password-di-prova. recupero@example.com is reserved to e2e/password.spec.ts,
-- which changes its password: no other test signs in with it.
-- tablet-kiosk: pin@example.com is reserved to the E2E that sets a PIN from the phone (it starts
-- without one); cassa@example.com is the till tablet (device account) and cassa-blocco@example.com
-- a second tablet reserved to the E2E of the 5-wrong-PIN lock, so the lock never stops other tests;
-- cassa-pin@example.com a third tablet reserved to the E2E of the PIN set from the phone, so its
-- cashier never replaces the one of the tests on cassa@example.com running at the same time;
-- cassa-layout@example.com a fourth tablet reserved to the E2E of the 1280×800 layouts, likewise.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('password-di-prova', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'admin@example.com'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'operatore@example.com'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'recupero@example.com'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'pin@example.com'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'cassa@example.com'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'cassa-blocco@example.com'),
  ('77777777-7777-4777-8777-777777777777'::uuid, 'cassa-pin@example.com'),
  ('88888888-8888-4888-8888-888888888888'::uuid, 'cassa-layout@example.com')
) as fake (id, email);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  now(), now(), now()
from auth.users
where email in ('admin@example.com', 'operatore@example.com', 'recupero@example.com',
                'pin@example.com', 'cassa@example.com', 'cassa-blocco@example.com',
                'cassa-pin@example.com', 'cassa-layout@example.com');

select private.add_operator('admin@example.com', 'Admin Prova', 'admin');
select private.add_operator('operatore@example.com', 'Operatore Prova', 'operator');
select private.add_operator('recupero@example.com', 'Recupero Prova', 'operator');
select private.add_operator('pin@example.com', 'Pin Prova', 'operator');

-- Device accounts (tablet-kiosk): no cashier, unlocked.
select private.add_device('cassa@example.com', 'Tablet cassa');
select private.add_device('cassa-blocco@example.com', 'Tablet blocco');
select private.add_device('cassa-pin@example.com', 'Tablet cambio PIN');
select private.add_device('cassa-layout@example.com', 'Tablet layout');

-- Fake till PINs (tablet-kiosk), stored as set_my_pin stores them (bcrypt, cost 8):
-- Admin Prova 2468, Operatore Prova 1357, Recupero Prova 8024. Pin Prova has none.
insert into private.operator_pins (operator_id, pin_hash)
select o.id, extensions.crypt(fake.pin, extensions.gen_salt('bf', 8))
from (values
  ('Admin Prova', '2468'),
  ('Operatore Prova', '1357'),
  ('Recupero Prova', '8024')
) as fake (name, pin)
join app.operators o on o.name = fake.name;

-- Fake customers (customers module): invented names, invented @example.com emails; two
-- customers without an email (it is optional, SPEC-customers-v2 point 2).
insert into app.customers (id, name, email, privacy_consent_at, notes, created_by, create_operation_id)
select
  fake.id, fake.name, fake.email, now(), fake.notes,
  (select id from app.operators where name = 'Admin Prova'), fake.operation_id
from (values
  ('c0000000-0000-4000-8000-000000000001'::uuid, 'Giulia Bianchi', 'giulia.bianchi@example.com',
   'Cappuccino d''orzo', 'c1000000-0000-4000-8000-000000000001'::uuid),
  ('c0000000-0000-4000-8000-000000000002'::uuid, 'Marco Esposito', 'marco.esposito@example.com', null,
   'c1000000-0000-4000-8000-000000000002'::uuid),
  ('c0000000-0000-4000-8000-000000000003'::uuid, 'Anna Ferrari', null, null,
   'c1000000-0000-4000-8000-000000000003'::uuid),
  ('c0000000-0000-4000-8000-000000000004'::uuid, 'Luca Romano', null, null,
   'c1000000-0000-4000-8000-000000000004'::uuid),
  ('c0000000-0000-4000-8000-000000000005'::uuid, 'Sara Colombo', 'sara.colombo@example.com',
   'Senza lattosio', 'c1000000-0000-4000-8000-000000000005'::uuid)
) as fake (id, name, email, notes, operation_id);

-- Fake rewards (rewards module): the catalogue of the "Catalogo premi" wireframe.
-- The ledger E2E relies on them: tests never modify these rows.
insert into app.rewards (id, name, points, active, created_by, updated_by)
select
  fake.id, fake.name, fake.points, fake.active, admin.id, admin.id
from (values
  ('e0000000-0000-4000-8000-000000000001'::uuid, 'Caffè', 50, true),
  ('e0000000-0000-4000-8000-000000000002'::uuid, 'Cornetto e cappuccino', 100, true),
  ('e0000000-0000-4000-8000-000000000003'::uuid, 'Dolce del giorno', 120, false),
  ('e0000000-0000-4000-8000-000000000004'::uuid, 'Colazione per due', 180, true),
  ('e0000000-0000-4000-8000-000000000005'::uuid, 'Aperitivo', 200, true)
) as fake (id, name, points, active)
cross join (select id from app.operators where name = 'Admin Prova') as admin;

-- Fake card (cards module): an invented uid on a fake customer, its link not written.
-- No token here: the repository is public. Tests never modify this row.
insert into app.cards (id, uid, customer_id, associated_by)
select
  'ca000000-0000-4000-8000-000000000001'::uuid, '04AABBCCDDEE01',
  'c0000000-0000-4000-8000-000000000003'::uuid, admin.id
from (select id from app.operators where name = 'Admin Prova') as admin;
