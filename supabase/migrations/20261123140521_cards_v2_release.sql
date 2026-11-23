-- customers-v2: reformatted cards (SPEC-customers-v2.md, "Modello dati", app.cards).
-- An admin empties a deactivated card and then releases it: the row stays, with the
-- uid and the customer of the time, for the history; released_at takes it out of
-- the uid index, so the same uid can get a new row for a new customer. A release is
-- final: written once, only on an inactive card, and the card never becomes active
-- again. No message, detail or log carries a uid.

-- Columns and constraints -------------------------------------------------------------------
alter table app.cards
  add column released_at timestamptz,
  add column released_by uuid references app.operators (id),
  add column release_operation_id uuid constraint cards_release_operation_id_key unique,
  add constraint cards_released_inactive_check check (released_at is null or not active),
  add constraint cards_released_check check (
    (released_at is null) = (released_by is null)
    and (released_at is null) = (release_operation_id is null)
  );

-- The uid is unique among the cards not released. The index keeps the name of the
-- old constraint: the constraint_name of a unique_violation on an index is the
-- index name, so private.associate_card_to still turns it into card_taken.
alter table app.cards drop constraint cards_uid_key;
create unique index cards_uid_key on app.cards (uid) where released_at is null;

create index cards_released_by_idx on app.cards (released_by);

comment on column app.cards.released_at is
  'Reformatted: emptied by an admin and unbound from its uid forever. Written once.';

-- Trigger: a release is final -----------------------------------------------------------------
-- Same rules as before, plus: released_at, released_by and release_operation_id are
-- written once, only on a card that is and stays inactive, and never go back to
-- null; a released card never becomes active again (the check says it too).
create or replace function private.cards_before_update()
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
  if old.released_at is not null then
    if new.released_at is distinct from old.released_at
       or new.released_by is distinct from old.released_by
       or new.release_operation_id is distinct from old.release_operation_id then
      raise exception 'A release is written once and never undone' using errcode = '55000';
    end if;
    if new.active then
      raise exception 'A released card never becomes active again' using errcode = '55000';
    end if;
  elsif (new.released_at is not null or new.released_by is not null
         or new.release_operation_id is not null)
        and (old.active or new.active) then
    raise exception 'Only an inactive card can be released' using errcode = '55000';
  end if;
  if old.active and not new.active then
    new.link_written_at := null;
    new.link_written_by := null;
    new.link_pending_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.cards_before_update() from public, anon, authenticated;

-- Every lookup by uid sees only the cards not released ------------------------------------------
create or replace function app.lookup_card(p_uid text)
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
    where c.uid = p_uid and c.released_at is null;
end;
$$;

revoke execute on function app.lookup_card(text) from public, anon;
grant execute on function app.lookup_card(text) to authenticated;

-- With a released row and a new row of the same uid, the owner is the new one
-- (into strict would fail with too_many_rows otherwise).
create or replace function private.raise_card_taken(p_uid text)
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
  where c.uid = p_uid and c.released_at is null;

  raise exception 'card_taken' using errcode = 'P0001', detail = v_detail::text;
end;
$$;

revoke execute on function private.raise_card_taken(text) from public, anon, authenticated;

create or replace function private.associate_card_to(p_customer_id uuid, p_uid text)
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

  -- A released row is history: the uid is free, so it gets a new row below.
  select * into v_card from app.cards where uid = p_uid and released_at is null for update;
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

-- release_card --------------------------------------------------------------------------------
-- An admin reformatted a deactivated card (the app emptied it and read it back):
-- the card is unbound from its uid forever. The server cannot know the card was
-- really emptied; that is a step of the interface. Customer, movements and balance
-- are not touched. Idempotent: the same operation_id, or any call on a card already
-- released, returns the row unchanged. Locks the customer, then the card, like
-- associate_card_to, so it never deadlocks with it.
create function app.release_card(p_operation_id uuid, p_card_id uuid)
returns app.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_card app.cards;
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;
  if p_operation_id is null then
    raise exception 'operation_id is required' using errcode = '22023';
  end if;
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- customer_id never changes, so it can be read before any lock.
  select customer_id into v_customer_id from app.cards where id = p_card_id;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0001';
  end if;
  perform 1 from app.customers where id = v_customer_id for update;
  select * into strict v_card from app.cards where id = p_card_id for update;

  if v_card.released_at is not null then
    return v_card;
  end if;
  if exists (select 1 from app.cards where release_operation_id = p_operation_id) then
    raise exception 'operation_id already used for another card' using errcode = '22023';
  end if;
  if v_card.active then
    raise exception 'card_active' using errcode = 'P0001';
  end if;

  begin
    update app.cards
    set released_at = now(),
        released_by = private.acting_operator_id(),
        release_operation_id = p_operation_id
    where id = p_card_id
    returning * into v_card;
  exception when unique_violation then
    -- The same operation_id committed on another card in the meantime.
    raise exception 'operation_id already used for another card' using errcode = '22023';
  end;

  -- Normally empty already: the deactivation deleted the link.
  delete from private.card_links where card_id = p_card_id;

  return v_card;
end;
$$;

revoke execute on function app.release_card(uuid, uuid) from public, anon;
grant execute on function app.release_card(uuid, uuid) to authenticated;
