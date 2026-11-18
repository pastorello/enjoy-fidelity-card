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
create function app.associate_card(p_customer_id uuid, p_uid text)
returns app.card_association
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer app.customers;
  v_card app.cards;
  v_replaced_id uuid;
  v_constraint text;
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;
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
