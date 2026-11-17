-- Development seed. Fake data only: this repository is public, never put real
-- customer data here.

-- Fake accounts for local development, E2E and integration tests.
-- Password for all: password-di-prova. recupero@example.com is reserved to e2e/password.spec.ts,
-- which changes its password: no other test signs in with it.
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
  ('33333333-3333-4333-8333-333333333333'::uuid, 'recupero@example.com')
) as fake (id, email);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  now(), now(), now()
from auth.users
where email in ('admin@example.com', 'operatore@example.com', 'recupero@example.com');

select private.add_operator('admin@example.com', 'Admin Prova', 'admin');
select private.add_operator('operatore@example.com', 'Operatore Prova', 'operator');
select private.add_operator('recupero@example.com', 'Recupero Prova', 'operator');
