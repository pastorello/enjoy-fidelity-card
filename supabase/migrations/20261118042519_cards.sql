-- cards (SPEC-cards.md, "Modello dati e regole di accesso"): one row per NFC tag
-- ever associated, bound to one customer forever; at most one active card per
-- customer. Read access for active operators; writes only through the security
-- definer RPCs below, which raise errcode P0001 with a code as message that the
-- frontend translates. No message ever contains a uid.

-- uid rule ----------------------------------------------------------------------------
-- The canonical uid of normalizeUid (src/features/card-input/normalizeUid.ts):
-- upper-case hex, no separators, 4 to 10 whole bytes, not all zeros.
create function private.is_card_uid(p_uid text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_uid ~ '^[0-9A-F]{8,20}$' and length(p_uid) % 2 = 0 and p_uid !~ '^0+$',
    false
  );
$$;

revoke execute on function private.is_card_uid(text) from public, anon, authenticated;

-- Table ------------------------------------------------------------------------------
create table app.cards (
  id uuid primary key default gen_random_uuid(),
  uid text not null constraint cards_uid_key unique
    constraint cards_uid_check check (private.is_card_uid(uid)),
  customer_id uuid not null references app.customers (id),
  active boolean not null default true,
  associated_at timestamptz not null default now(),
  associated_by uuid not null references app.operators (id),
  deactivated_at timestamptz,
  -- the link to the points written on the card and verified
  link_written_at timestamptz,
  link_written_by uuid references app.operators (id),
  -- the last link issued and not confirmed yet (not a secret)
  link_pending_at timestamptz,
  constraint cards_deactivated_at_check
    check ((active and deactivated_at is null) or (not active and deactivated_at is not null)),
  constraint cards_link_written_check check ((link_written_at is null) = (link_written_by is null)),
  -- a deactivated card has no link
  constraint cards_inactive_link_check
    check (active or (link_written_at is null and link_pending_at is null))
);

comment on table app.cards is
  'NFC cards of the customers. Written only by the cards RPCs; rows are never deleted.';

create unique index cards_one_active_per_customer on app.cards (customer_id) where active;
create index cards_customer_id_idx on app.cards (customer_id);
create index cards_associated_by_idx on app.cards (associated_by);
create index cards_link_written_by_idx on app.cards (link_written_by);

alter table app.cards enable row level security;

-- Rows are written only through the RPCs below and never deleted.
revoke insert, update, delete, truncate on app.cards from authenticated, anon;

create policy cards_select_for_active_operators
  on app.cards
  for select
  to authenticated
  using ((select private.is_active_operator()));

-- Triggers -----------------------------------------------------------------------------
-- A card never moves to another uid or customer; associated_at/by change only
-- when a deactivated card becomes active again. A deactivation clears the state
-- of the link: the link of a lost card must stop working.
create function private.cards_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.uid is distinct from old.uid then
    raise exception 'The uid of a card never changes' using errcode = '55000';
  end if;
  if new.customer_id is distinct from old.customer_id then
    raise exception 'The customer of a card never changes' using errcode = '55000';
  end if;
  if (new.associated_at is distinct from old.associated_at
      or new.associated_by is distinct from old.associated_by)
     and not (not old.active and new.active) then
    raise exception 'associated_at and associated_by change only on reactivation' using errcode = '55000';
  end if;
  if old.active and not new.active then
    new.link_written_at := null;
    new.link_written_by := null;
    new.link_pending_at := null;
  end if;
  return new;
end;
$$;

create function private.cards_before_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Cards are never deleted: deactivate them' using errcode = '55000';
end;
$$;

revoke execute on function private.cards_before_update(), private.cards_before_delete()
  from public, anon, authenticated;

create trigger cards_before_update
  before update on app.cards
  for each row execute function private.cards_before_update();

create trigger cards_before_delete
  before delete on app.cards
  for each row execute function private.cards_before_delete();

-- What associate_card returns: the active card and the card it replaced, if any.
create type app.card_association as (
  id uuid,
  uid text,
  customer_id uuid,
  active boolean,
  associated_at timestamptz,
  associated_by uuid,
  deactivated_at timestamptz,
  link_written_at timestamptz,
  link_written_by uuid,
  link_pending_at timestamptz,
  replaced_card_id uuid
);

-- lookup_card ----------------------------------------------------------------------------
-- No row for an unknown card; the name is null when the customer is anonymized.
create function app.lookup_card(p_uid text)
returns table (
  card_id uuid,
  customer_id uuid,
  customer_name text,
  active boolean,
  customer_anonymized boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;
  if not private.is_card_uid(p_uid) then
    raise exception 'invalid_uid' using errcode = 'P0001';
  end if;

  return query
    select
      c.id,
      c.customer_id,
      case when cu.anonymized_at is null then cu.name end,
      c.active,
      cu.anonymized_at is not null
    from app.cards c
    join app.customers cu on cu.id = c.customer_id
    where c.uid = p_uid;
end;
$$;

revoke execute on function app.lookup_card(text) from public, anon;
grant execute on function app.lookup_card(text) to authenticated;

-- card_taken --------------------------------------------------------------------------------
-- Raised when a uid belongs to another customer. The detail is JSON: owner_id,
-- owner_name (null when that customer is anonymized) and active.
create function private.raise_card_taken(p_uid text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_detail jsonb;
begin
  select jsonb_build_object(
    'owner_id', c.customer_id,
    'owner_name', case when cu.anonymized_at is null then cu.name end,
    'active', c.active
  )
  into strict v_detail
  from app.cards c
  join app.customers cu on cu.id = c.customer_id
  where c.uid = p_uid;

  raise exception 'card_taken' using errcode = 'P0001', detail = v_detail::text;
end;
$$;

revoke execute on function private.raise_card_taken(text) from public, anon, authenticated;

-- associate_card ---------------------------------------------------------------------------
-- Gives the customer the card with this uid: a card already active on this
-- customer changes nothing (a resent request); the customer's own deactivated
-- card is reactivated; otherwise a new card. Any other active card of the
-- customer is deactivated (replacement). The customer row is locked, so two
-- associations to the same customer run one after the other.
-- private.associate_card_to is the logic shared with create_customer_with_card;
-- its callers check the operator first.
create function private.associate_card_to(p_customer_id uuid, p_uid text)
returns app.card_association
language plpgsql
set search_path = ''
as $$
declare
  v_customer app.customers;
  v_card app.cards;
  v_replaced_id uuid;
  v_constraint text;
begin
  if not private.is_card_uid(p_uid) then
    raise exception 'invalid_uid' using errcode = 'P0001';
  end if;

  select * into v_customer from app.customers where id = p_customer_id for update;
  if not found then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;
  if v_customer.anonymized_at is not null then
    raise exception 'customer_anonymized' using errcode = 'P0001';
  end if;

  select * into v_card from app.cards where uid = p_uid for update;
  if found then
    if v_card.customer_id <> p_customer_id then
      perform private.raise_card_taken(p_uid);
    end if;
    if v_card.active then
      return (v_card.id, v_card.uid, v_card.customer_id, v_card.active, v_card.associated_at,
              v_card.associated_by, v_card.deactivated_at, v_card.link_written_at,
              v_card.link_written_by, v_card.link_pending_at, null)::app.card_association;
    end if;
  end if;

  -- Replacement: the active card, if any, stops working before the new one starts.
  update app.cards
  set active = false, deactivated_at = now()
  where customer_id = p_customer_id and active
  returning id into v_replaced_id;

  if v_card.id is not null then
    -- The customer's own deactivated card: it starts again from "link not written".
    update app.cards
    set active = true,
        deactivated_at = null,
        associated_at = now(),
        associated_by = private.acting_operator_id()
    where id = v_card.id
    returning * into v_card;
  else
    begin
      insert into app.cards (uid, customer_id, associated_by)
      values (p_uid, p_customer_id, private.acting_operator_id())
      returning * into v_card;
    exception when unique_violation then
      -- Another operator associated this uid first: it belongs to someone else now.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'cards_uid_key' then
        perform private.raise_card_taken(p_uid);
      end if;
      raise;
    end;
  end if;

  return (v_card.id, v_card.uid, v_card.customer_id, v_card.active, v_card.associated_at,
          v_card.associated_by, v_card.deactivated_at, v_card.link_written_at,
          v_card.link_written_by, v_card.link_pending_at, v_replaced_id)::app.card_association;
end;
$$;

revoke execute on function private.associate_card_to(uuid, text) from public, anon, authenticated;

create function app.associate_card(p_customer_id uuid, p_uid text)
returns app.card_association
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;
  return private.associate_card_to(p_customer_id, p_uid);
end;
$$;

revoke execute on function app.associate_card(uuid, text) from public, anon;
grant execute on function app.associate_card(uuid, text) to authenticated;

-- deactivate_card ----------------------------------------------------------------------------
-- A lost card: it stops working, the customer and the points stay. Repeating it
-- on a deactivated card changes nothing.
create function app.deactivate_card(p_card_id uuid)
returns app.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card app.cards;
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;

  select * into v_card from app.cards where id = p_card_id for update;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0001';
  end if;

  if v_card.active then
    update app.cards
    set active = false, deactivated_at = now()
    where id = p_card_id
    returning * into v_card;
  end if;

  return v_card;
end;
$$;

revoke execute on function app.deactivate_card(uuid) from public, anon;
grant execute on function app.deactivate_card(uuid) to authenticated;

-- create_customer_with_card -----------------------------------------------------------------
-- New customer from an unknown card, all or nothing: create_customer (same
-- checks, same errors, same operation_id) and then the logic of associate_card
-- in one transaction, so any error (card_taken, invalid_uid, the customer
-- errors) leaves neither customer nor card. A resent operation_id returns the
-- customer the first request created without touching the cards: that request
-- was all or nothing too.
create function app.create_customer_with_card(
  p_operation_id uuid,
  p_name text,
  p_phone text,
  p_privacy_consent boolean,
  p_notes text,
  p_uid text
)
returns app.customer_summary
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.customers;
  v_summary app.customer_summary;
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;
  if p_operation_id is null then
    raise exception 'operation_id is required' using errcode = '22023';
  end if;

  select * into v_row from app.customers where create_operation_id = p_operation_id;
  if found then
    return (v_row.id, v_row.name, v_row.phone, v_row.notes, v_row.anonymized_at, 0, null)
      ::app.customer_summary;
  end if;

  if not private.is_card_uid(p_uid) then
    raise exception 'invalid_uid' using errcode = 'P0001';
  end if;

  v_summary := app.create_customer(p_operation_id, p_name, p_phone, p_privacy_consent, p_notes);
  perform private.associate_card_to(v_summary.id, p_uid);
  return v_summary;
end;
$$;

revoke execute on function app.create_customer_with_card(uuid, text, text, boolean, text, text)
  from public, anon;
grant execute on function app.create_customer_with_card(uuid, text, text, boolean, text, text)
  to authenticated;

-- Anonymization -------------------------------------------------------------------------------
-- When a customer's personal data is erased, the active card stops working; the
-- uid stays bound to that customer and is never reused (card_taken without a name).
create function private.customers_after_anonymize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update app.cards
  set active = false, deactivated_at = now()
  where customer_id = new.id and active;
  return null;
end;
$$;

revoke execute on function private.customers_after_anonymize() from public, anon, authenticated;

create trigger customers_after_anonymize
  after update of anonymized_at on app.customers
  for each row
  when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function private.customers_after_anonymize();

-- Link to the points -------------------------------------------------------------------------
-- The card stores only https://<origin>/s/<token>. The token is 128 random bits
-- generated here; the database keeps only its sha256 fingerprint, in a table
-- outside the API schema that no role can read: only the security definer
-- functions below touch it. A token is "pending" from issue_card_link until the
-- app has read it back from the card and called confirm_card_link; only then it
-- becomes the valid link (token_hash), replacing the previous one at once.
create table private.card_links (
  card_id uuid primary key references app.cards (id),
  token_hash bytea constraint card_links_token_hash_key unique
    constraint card_links_token_hash_check check (octet_length(token_hash) = 32),
  pending_hash bytea constraint card_links_pending_hash_key unique
    constraint card_links_pending_hash_check check (octet_length(pending_hash) = 32),
  pending_issued_at timestamptz,
  pending_issued_by uuid references app.operators (id),
  constraint card_links_pending_check check (
    (pending_hash is null) = (pending_issued_at is null)
    and (pending_hash is null) = (pending_issued_by is null)
  )
);

comment on table private.card_links is
  'sha256 fingerprints of the card links (valid and pending). Never the token in clear.';

create index card_links_pending_issued_by_idx on private.card_links (pending_issued_by);

alter table private.card_links enable row level security;
revoke all on private.card_links from public, anon, authenticated;

-- The one fingerprint of a token, the same in every function that compares one.
create function private.card_token_hash(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(convert_to(p_token, 'UTF8'), 'sha256');
$$;

revoke execute on function private.card_token_hash(text) from public, anon, authenticated;

-- Any deactivation (replacement, deactivate_card, anonymization) kills the link:
-- cards_before_update clears the state in app.cards, this deletes the fingerprints.
create function private.cards_after_deactivate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from private.card_links where card_id = new.id;
  return null;
end;
$$;

revoke execute on function private.cards_after_deactivate() from public, anon, authenticated;

create trigger cards_after_deactivate
  after update of active on app.cards
  for each row
  when (old.active and not new.active)
  execute function private.cards_after_deactivate();

-- issue_card_link ------------------------------------------------------------------------------
-- A new pending token for an active card, returned in clear: the only time it
-- leaves the server. It replaces any pending token and leaves the written link
-- valid until the new one is confirmed. Repeating it only issues another pending
-- token, so it needs no operation_id.
create function app.issue_card_link(p_card_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_card app.cards;
  v_token text;
  v_now timestamptz := now();
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;

  select * into v_card from app.cards where id = p_card_id for update;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0001';
  end if;
  if not v_card.active then
    raise exception 'card_inactive' using errcode = 'P0001';
  end if;

  -- 16 random bytes in base64url without padding: 22 characters [A-Za-z0-9_-].
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=');

  insert into private.card_links (card_id, pending_hash, pending_issued_at, pending_issued_by)
  values (p_card_id, private.card_token_hash(v_token), v_now, private.acting_operator_id())
  on conflict (card_id) do update
  set pending_hash = excluded.pending_hash,
      pending_issued_at = excluded.pending_issued_at,
      pending_issued_by = excluded.pending_issued_by;

  update app.cards set link_pending_at = v_now where id = p_card_id;

  return v_token;
end;
$$;

revoke execute on function app.issue_card_link(uuid) from public, anon;
grant execute on function app.issue_card_link(uuid) to authenticated;

-- confirm_card_link ----------------------------------------------------------------------------
-- The app read the token back from the card: the pending token becomes the valid
-- link and the previous one stops working in the same instant. The valid token
-- again changes nothing (a resent request). Any other token, including one
-- replaced by a newer issue, is link_token_mismatch. No error carries the token,
-- its fingerprint or the uid.
create function app.confirm_card_link(p_card_id uuid, p_token text)
returns app.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card app.cards;
  v_link private.card_links;
  v_hash bytea;
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;

  select * into v_card from app.cards where id = p_card_id for update;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0001';
  end if;
  if not v_card.active then
    raise exception 'card_inactive' using errcode = 'P0001';
  end if;

  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'link_token_mismatch' using errcode = 'P0001';
  end if;
  v_hash := private.card_token_hash(p_token);

  select * into v_link from private.card_links where card_id = p_card_id for update;
  if found and v_link.token_hash = v_hash then
    return v_card;
  end if;
  if not found or v_link.pending_hash is distinct from v_hash then
    raise exception 'link_token_mismatch' using errcode = 'P0001';
  end if;

  update private.card_links
  set token_hash = pending_hash,
      pending_hash = null,
      pending_issued_at = null,
      pending_issued_by = null
  where card_id = p_card_id;

  update app.cards
  set link_written_at = now(),
      link_written_by = private.acting_operator_id(),
      link_pending_at = null
  where id = p_card_id
  returning * into v_card;

  return v_card;
end;
$$;

revoke execute on function app.confirm_card_link(uuid, text) from public, anon;
grant execute on function app.confirm_card_link(uuid, text) to authenticated;

-- card_points ----------------------------------------------------------------------------------
-- The public page /s/<token>: the points of the card whose confirmed link is this
-- token, for anyone (anon key, no account). The only function anon may run; it
-- sits in public because app is closed to anon. It answers only an integer or
-- null: never an error, never a name, id, uid or date, and the same null for a
-- token that never existed, is only pending, belongs to a deactivated card or to
-- an anonymized customer. It writes nothing and logs nothing.
create function public.card_points(p_token text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_balance integer;
begin
  -- PostgREST turns this into a response header: no browser or proxy keeps it.
  perform set_config('response.headers', '[{"Cache-Control": "no-store"}]', true);

  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;

  select c.customer_id into v_customer_id
  from private.card_links l
  join app.cards c on c.id = l.card_id and c.active
  join app.customers cu on cu.id = c.customer_id and cu.anonymized_at is null
  where l.token_hash = private.card_token_hash(p_token);
  if not found then
    return null;
  end if;

  -- The balance has one definition, private.customer_balance from the ledger
  -- module. Until that module exists there are no movements, so it is 0.
  if to_regprocedure('private.customer_balance(uuid)') is null then
    return 0;
  end if;
  execute 'select private.customer_balance($1)::integer' into strict v_balance using v_customer_id;
  return v_balance;
end;
$$;

revoke execute on function public.card_points(text) from public;
grant execute on function public.card_points(text) to anon, authenticated;
