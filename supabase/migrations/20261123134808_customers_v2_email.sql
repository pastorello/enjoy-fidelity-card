-- customers-v2, migration 2 of 4: the optional email of a customer and the home list
-- (SPEC-customers-v2.md points 2 and 6). Transitional form: the customers RPCs take the
-- email and still accept the phone (p_phone default null), customer_summary carries both
-- (email as its last attribute) and export_customers returns both, so the app that still
-- sends p_phone keeps working while it moves to the email in later tasks of this branch.
-- This file reaches its final form (phone dropped) before it is published (plan.md).

-- The email -----------------------------------------------------------------------------
-- Stored lowercase and trimmed (the client and the RPCs normalize it first), 6–254
-- characters, one @ with a dot after it. Unique: nulls never collide, so many customers
-- may have none, and an anonymized customer (email = null) frees its own.
alter table app.customers
  add column email text null,
  add constraint customers_email_check check (
    email = lower(btrim(email))
    and length(email) between 6 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );

comment on column app.customers.email is
  'Optional, unique, lowercase. Only to find the customer at the till: the app never writes to customers.';

create unique index customers_email_key on app.customers (email);

-- list_customers ------------------------------------------------------------------------
-- One keyset page of the home list. Order: customers with a purchase or a redemption
-- first (cancelled ones included, corrections excluded), latest first; then the others,
-- latest creation first; then id descending. Anonymized customers never listed.
--
-- Filter from 2 characters (after clean_name, text cut at 80): every word contained in
-- the name key, or the whole text, lowercased, contained in the email; \, % and _ are
-- searched literally. Fewer than 2 characters: the full list.
--
-- Cursor: all null (first page), or p_after_id and p_after_created_at set (plus
-- p_after_activity_at when the last row had activity). A partial cursor is refused:
-- comparing a row with a null gives NULL and an empty page, which would look like the
-- end of the list.
--
-- No email in the result (plan.md): the list never shows it and the filter runs here.
-- Custom plans always, so the null cursor of the first page folds away and every page
-- reads customers_home_order_idx with the row condition as its index condition.
create function app.list_customers(
  p_query text default null,
  p_after_activity_at timestamptz default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit int default 20
)
returns table (id uuid, name text, balance int, last_activity_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  v_text text := private.clean_name(left(coalesce(p_query, ''), 80));
  v_patterns text[];
  v_email_pattern text;
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  if (p_after_id is null and (p_after_activity_at is not null or p_after_created_at is not null))
     or (p_after_id is not null and p_after_created_at is null) then
    raise exception 'invalid_cursor' using errcode = '22023';
  end if;

  if length(v_text) >= 2 then
    -- One pattern per word for the name key, one for the whole text in the email.
    select array_agg(
      '%' || replace(replace(replace(private.customer_name_key(w), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
    into v_patterns
    from unnest(string_to_array(v_text, ' ')) as w;
    v_email_pattern :=
      '%' || replace(replace(replace(lower(v_text), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- The balance is computed only for the (at most p_limit) rows returned.
  return query
    select f.id, f.name, private.customer_balance(f.id), f.last_activity_at, f.created_at
    from (
      select c.id, c.name, c.last_activity_at, c.created_at, c.has_activity, c.sort_at
      from app.customers c
      where c.anonymized_at is null
        and (v_patterns is null or c.name_key like all (v_patterns) or c.email like v_email_pattern)
        and (p_after_id is null
             or (c.has_activity, c.sort_at, c.id)
                < (p_after_activity_at is not null, coalesce(p_after_activity_at, p_after_created_at),
                   p_after_id))
      order by c.has_activity desc, c.sort_at desc, c.id desc
      limit p_limit
    ) f
    order by f.has_activity desc, f.sort_at desc, f.id desc;
end;
$$;

revoke execute on function app.list_customers(text, timestamptz, timestamptz, uuid, int) from public, anon;
grant execute on function app.list_customers(text, timestamptz, timestamptz, uuid, int) to authenticated;

-- normalize_email -------------------------------------------------------------------------
-- The stored form of an email typed by an operator: whitespace at the edges trimmed
-- (Unicode too, like clean_name, plus the zero-width space and the BOM), lowercased; empty
-- -> null. Mirrored by normalizeEmail in src/features/customers/email.ts. The format is
-- checked by private.check_email, against the very expressions of customers_email_check.
create function private.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    lower(regexp_replace(p_email, '^[\s​﻿]+|[\s​﻿]+$', '', 'g')),
    ''
  );
$$;

-- email_invalid when a normalized email would fail customers_email_check. Never puts the
-- email in the message or the detail.
create function private.check_email(p_email text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_email is not null and not (
    length(p_email) between 6 and 254
    and p_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ) then
    raise exception 'email_invalid' using errcode = 'P0001';
  end if;
end;
$$;

-- customer_email_taken, with the id of the customer that has the email (never the email).
create function private.raise_email_taken(p_email text, p_except_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_taken_id uuid;
begin
  select id into v_taken_id
  from app.customers
  where email = p_email and id is distinct from p_except_id;
  if found then
    raise exception 'customer_email_taken' using errcode = 'P0001', detail = v_taken_id::text;
  end if;
end;
$$;

revoke execute on function
  private.normalize_email(text), private.check_email(text), private.raise_email_taken(text, uuid)
  from public, anon, authenticated;

-- customer_summary ------------------------------------------------------------------------
-- email last, so every positional constructor below lists it last.
alter type app.customer_summary add attribute email text;

-- create_customer -------------------------------------------------------------------------
-- Checks as before, then the email (SPEC-customers-v2.md point 2): customer_name_taken
-- comes first, so a name and an email both taken report only the name; then email_invalid
-- and customer_email_taken. A race on customers_email_key ends as customer_email_taken.
drop function app.create_customer(uuid, text, text, boolean, text);

create function app.create_customer(
  p_operation_id uuid,
  p_name text,
  p_phone text default null,
  p_privacy_consent boolean default null,
  p_notes text default null,
  p_email text default null
)
returns app.customer_summary
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.clean_name(p_name);
  v_phone text := nullif(btrim(p_phone, E' \t\n\r\f\v'), '');
  v_email text := private.normalize_email(p_email);
  v_notes text := nullif(btrim(p_notes, E' \t\n\r\f\v'), '');
  v_row app.customers;
  v_taken_id uuid;
  v_constraint text;
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;
  if p_operation_id is null then
    raise exception 'operation_id is required' using errcode = '22023';
  end if;

  -- A resent request: return what the first one created.
  select * into v_row from app.customers where create_operation_id = p_operation_id;
  if found then
    return (v_row.id, v_row.name, v_row.phone, v_row.notes, v_row.anonymized_at, 0, null, v_row.email)
      ::app.customer_summary;
  end if;

  if v_name is null or v_name = '' then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if length(v_name) > 80 then
    raise exception 'name_too_long' using errcode = 'P0001';
  end if;
  if v_phone is not null then
    v_phone := private.normalize_phone(v_phone);
    if v_phone is null then
      raise exception 'phone_invalid' using errcode = 'P0001';
    end if;
  end if;
  if p_privacy_consent is not true then
    raise exception 'consent_required' using errcode = 'P0001';
  end if;
  if length(v_notes) > 500 then
    raise exception 'notes_too_long' using errcode = 'P0001';
  end if;

  select id into v_taken_id from app.customers where name_key = private.customer_name_key(v_name);
  if found then
    raise exception 'customer_name_taken' using errcode = 'P0001', detail = v_taken_id::text;
  end if;

  perform private.check_email(v_email);
  perform private.raise_email_taken(v_email, null);

  begin
    insert into app.customers (
      name, phone, email, privacy_consent_at, notes, created_by, create_operation_id
    )
    values (v_name, v_phone, v_email, now(), v_notes, private.acting_operator_id(), p_operation_id)
    returning * into v_row;
  exception when unique_violation then
    -- A concurrent request committed first: settle it with the constraint it hit.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'customers_create_operation_id_key' then
      select * into strict v_row from app.customers where create_operation_id = p_operation_id;
    elsif v_constraint = 'customers_name_key' then
      select id into strict v_taken_id
      from app.customers
      where name_key = private.customer_name_key(v_name);
      raise exception 'customer_name_taken' using errcode = 'P0001', detail = v_taken_id::text;
    elsif v_constraint = 'customers_email_key' then
      perform private.raise_email_taken(v_email, null);
      raise;
    else
      raise;
    end if;
  end;

  return (v_row.id, v_row.name, v_row.phone, v_row.notes, v_row.anonymized_at, 0, null, v_row.email)
    ::app.customer_summary;
end;
$$;

revoke execute on function app.create_customer(uuid, text, text, boolean, text, text) from public, anon;
grant execute on function app.create_customer(uuid, text, text, boolean, text, text) to authenticated;

-- update_customer -------------------------------------------------------------------------
-- An empty email removes it; the customer's own email is not a conflict.
drop function app.update_customer(uuid, text, text, text);

create function app.update_customer(
  p_customer_id uuid,
  p_name text,
  p_phone text default null,
  p_notes text default null,
  p_email text default null
)
returns app.customer_summary
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.clean_name(p_name);
  v_phone text := nullif(btrim(p_phone, E' \t\n\r\f\v'), '');
  v_email text := private.normalize_email(p_email);
  v_notes text := nullif(btrim(p_notes, E' \t\n\r\f\v'), '');
  v_row app.customers;
  v_taken_id uuid;
  v_constraint text;
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;

  -- Locked before the check, so an anonymization cannot slip in between.
  select * into v_row from app.customers where id = p_customer_id for update;
  if not found then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;
  if v_row.anonymized_at is not null then
    raise exception 'customer_anonymized' using errcode = 'P0001';
  end if;

  if v_name is null or v_name = '' then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if length(v_name) > 80 then
    raise exception 'name_too_long' using errcode = 'P0001';
  end if;
  if v_phone is not null then
    v_phone := private.normalize_phone(v_phone);
    if v_phone is null then
      raise exception 'phone_invalid' using errcode = 'P0001';
    end if;
  end if;
  if length(v_notes) > 500 then
    raise exception 'notes_too_long' using errcode = 'P0001';
  end if;

  select id into v_taken_id
  from app.customers
  where name_key = private.customer_name_key(v_name) and id <> p_customer_id;
  if found then
    raise exception 'customer_name_taken' using errcode = 'P0001', detail = v_taken_id::text;
  end if;

  perform private.check_email(v_email);
  perform private.raise_email_taken(v_email, p_customer_id);

  begin
    update app.customers
    set name = v_name, phone = v_phone, email = v_email, notes = v_notes
    where id = p_customer_id
    returning * into v_row;
  exception when unique_violation then
    -- A concurrent request took the name or the email first.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'customers_name_key' then
      select id into strict v_taken_id
      from app.customers
      where name_key = private.customer_name_key(v_name) and id <> p_customer_id;
      raise exception 'customer_name_taken' using errcode = 'P0001', detail = v_taken_id::text;
    elsif v_constraint = 'customers_email_key' then
      perform private.raise_email_taken(v_email, p_customer_id);
      raise;
    else
      raise;
    end if;
  end;

  return (v_row.id, v_row.name, v_row.phone, v_row.notes, v_row.anonymized_at, 0, null, v_row.email)
    ::app.customer_summary;
end;
$$;

revoke execute on function app.update_customer(uuid, text, text, text, text) from public, anon;
grant execute on function app.update_customer(uuid, text, text, text, text) to authenticated;

-- anonymize_customer ----------------------------------------------------------------------
-- The email goes with the name and the notes, so another customer may take it at once.
create or replace function app.anonymize_customer(p_customer_id uuid)
returns app.customer_summary
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.customers;
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select * into v_row from app.customers where id = p_customer_id for update;
  if not found then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  if v_row.anonymized_at is null then
    begin
      update app.customers
      set name = 'Cliente cancellato ' || left(v_row.id::text, 8),
          phone = null,
          email = null,
          notes = null,
          anonymized_at = now()
      where id = p_customer_id
      returning * into v_row;
    exception when unique_violation then
      -- Another customer already has that name (typed by hand, or the same
      -- first 8 characters of the id): the full id is unique.
      update app.customers
      set name = 'Cliente cancellato ' || v_row.id::text,
          phone = null,
          email = null,
          notes = null,
          anonymized_at = now()
      where id = p_customer_id
      returning * into v_row;
    end;
  end if;

  return (v_row.id, v_row.name, v_row.phone, v_row.notes, v_row.anonymized_at, 0, null, v_row.email)
    ::app.customer_summary;
end;
$$;

-- Reads that return customer_summary ------------------------------------------------------
-- The bodies of ledger, with the email as the last column.
create or replace function app.search_customers(p_query text)
returns setof app.customer_summary
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_text text := private.clean_name(left(coalesce(p_query, ''), 80));
  v_digits text := regexp_replace(v_text, '[[:space:]+.-]', '', 'g');
  v_patterns text[];
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;

  if v_digits ~ '^[0-9]+$' then
    if length(v_digits) < 3 then
      return;
    end if;
    -- A leading 00 stands for +, and the + is not among the digits searched.
    if v_digits like '00%' then
      v_digits := substr(v_digits, 3);
    end if;
    return query
      select f.id, f.name, f.phone, f.notes, f.anonymized_at,
             private.customer_balance(f.id), private.last_served_today(f.id), f.email
      from (
        select c.id, c.name, c.phone, c.notes, c.anonymized_at, c.name_key, c.email
        from app.customers c
        where c.anonymized_at is null
          and c.phone like '%' || v_digits || '%'
        order by c.name_key, c.id
        limit 21
      ) f
      order by f.name_key, f.id;
    return;
  end if;

  if length(v_text) < 2 then
    return;
  end if;
  -- One pattern per word; \, % and _ are escaped so they are searched literally.
  select array_agg(
    '%' || replace(replace(replace(private.customer_name_key(w), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  )
  into v_patterns
  from unnest(string_to_array(v_text, ' ')) as w;

  -- The balance is computed only for the (at most 21) rows returned.
  return query
    select f.id, f.name, f.phone, f.notes, f.anonymized_at,
           private.customer_balance(f.id), private.last_served_today(f.id), f.email
    from (
      select c.id, c.name, c.phone, c.notes, c.anonymized_at, c.name_key, c.email
      from app.customers c
      where c.anonymized_at is null
        and c.name_key like all (v_patterns)
      order by c.name_key, c.id
      limit 21
    ) f
    order by f.name_key, f.id;
end;
$$;

create or replace function app.get_customer(p_customer_id uuid)
returns setof app.customer_summary
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;

  return query
    select c.id, c.name, c.phone, c.notes, c.anonymized_at,
           private.customer_balance(c.id), private.last_served_today(c.id), c.email
    from app.customers c
    where c.id = p_customer_id;
end;
$$;

create or replace function app.customers_served_today()
returns setof app.customer_summary
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_operator() then
    raise exception 'not_operator' using errcode = 'P0001';
  end if;

  return query
    select c.id, c.name, c.phone, c.notes, c.anonymized_at,
           private.customer_balance(c.id), s.last_served_at, c.email
    from (
      select m.customer_id, max(m.created_at) as last_served_at
      from app.movements m, private.today_bounds() b
      where m.kind in ('purchase', 'redemption')
        and m.created_at >= b.day_start
        and m.created_at < b.day_end
      group by m.customer_id
    ) s
    join app.customers c on c.id = s.customer_id and c.anonymized_at is null
    order by s.last_served_at desc, c.id
    limit 50;
end;
$$;

-- create_customer_with_card ---------------------------------------------------------------
-- The body of cards, passing the email on to create_customer by name.
drop function app.create_customer_with_card(uuid, text, text, boolean, text, text);

create function app.create_customer_with_card(
  p_operation_id uuid,
  p_name text,
  p_phone text default null,
  p_privacy_consent boolean default null,
  p_notes text default null,
  p_uid text default null,
  p_email text default null
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
    return (v_row.id, v_row.name, v_row.phone, v_row.notes, v_row.anonymized_at, 0, null, v_row.email)
      ::app.customer_summary;
  end if;

  if not private.is_card_uid(p_uid) then
    raise exception 'invalid_uid' using errcode = 'P0001';
  end if;

  v_summary := app.create_customer(
    p_operation_id => p_operation_id,
    p_name => p_name,
    p_phone => p_phone,
    p_privacy_consent => p_privacy_consent,
    p_notes => p_notes,
    p_email => p_email
  );
  perform private.associate_card_to(v_summary.id, p_uid);
  return v_summary;
end;
$$;

revoke execute on function app.create_customer_with_card(uuid, text, text, boolean, text, text, text)
  from public, anon;
grant execute on function app.create_customer_with_card(uuid, text, text, boolean, text, text, text)
  to authenticated;

-- export_customers ------------------------------------------------------------------------
-- The body of export, with the email after the phone; null for anonymized customers.
drop function app.export_customers(uuid, int);

create function app.export_customers(p_after_id uuid default null, p_limit int default 1000)
returns table (
  id uuid,
  name text,
  phone text,
  email text,
  active_card_uid text,
  balance_points int,
  privacy_consent_at timestamptz,
  notes text,
  created_at timestamptz,
  created_by_name text,
  anonymized_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;

  return query
    select
      c.id,
      case when c.anonymized_at is null then c.name end,
      case when c.anonymized_at is null then c.phone end,
      case when c.anonymized_at is null then c.email end,
      case when c.anonymized_at is null then card.uid end,
      private.customer_balance(c.id),
      c.privacy_consent_at,
      case when c.anonymized_at is null then c.notes end,
      c.created_at,
      o.name,
      c.anonymized_at
    from app.customers c
    join app.operators o on o.id = c.created_by
    left join app.cards card on card.customer_id = c.id and card.active
    where p_after_id is null or c.id > p_after_id
    order by c.id
    limit p_limit;
end;
$$;

revoke execute on function app.export_customers(uuid, int) from public, anon;
grant execute on function app.export_customers(uuid, int) to authenticated;
