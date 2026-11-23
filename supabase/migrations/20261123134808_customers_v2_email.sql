-- customers-v2, migration 2 of 4: the optional email of a customer and the home list
-- (SPEC-customers-v2.md points 2 and 6). First form, additions only: the customers RPCs
-- still take the phone; they move to the email in later tasks of this branch, and this
-- file reaches its final form (phone dropped) before it is published (plan.md).

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
