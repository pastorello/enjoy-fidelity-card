-- customers-v2, migration 1 of 4: the last activity of a customer, for the home list
-- (SPEC-customers-v2.md, "Ultima attività denormalizzata"). Additions only.
--
-- last_activity_at is the created_at of the customer's latest purchase or redemption,
-- cancelled ones included (the customer came to the bar; Open Question 1), corrections
-- excluded. Stored rather than computed so each page of the home list reads 20 rows of
-- one index instead of aggregating the whole ledger.

alter table app.customers
  add column last_activity_at timestamptz null,
  add column has_activity boolean generated always as (last_activity_at is not null) stored,
  add column sort_at timestamptz generated always as (coalesce(last_activity_at, created_at)) stored;

comment on column app.customers.last_activity_at is
  'Latest purchase or redemption (cancelled ones included, corrections excluded). Written only by the movements trigger.';
comment on column app.customers.has_activity is
  'Home list order: customers with at least one purchase or redemption first.';
comment on column app.customers.sort_at is
  'Home list order: last activity, or the creation for customers without one.';

-- The home list: (has_activity, sort_at, id) descending, anonymized customers never listed.
create index customers_home_order_idx
  on app.customers (has_activity desc, sort_at desc, id desc)
  where anonymized_at is null;

-- The trigger -----------------------------------------------------------------------------
-- The ledger RPCs already lock the customer row (private.lock_customer_for_ledger, for
-- update) before inserting, so this update adds no wait and no deadlock. greatest() keeps
-- the value from ever moving back when an older movement is inserted.
create function private.movements_after_insert_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update app.customers
  set last_activity_at = greatest(coalesce(last_activity_at, '-infinity'), new.created_at)
  where id = new.customer_id;
  return null;
end;
$$;

revoke execute on function private.movements_after_insert_activity() from public, anon, authenticated;

create trigger movements_after_insert_activity
  after insert on app.movements
  for each row
  when (new.kind in ('purchase', 'redemption'))
  execute function private.movements_after_insert_activity();

-- The backfill ------------------------------------------------------------------------------
-- A function rather than an inline update so pgTAP can prove it: on a fresh database the
-- seed runs after the migrations, so the inline statement would never meet a movement.
-- Only raises values (never clears one), like the trigger.
create function private.backfill_customer_activity()
returns void
language plpgsql
set search_path = ''
as $$
begin
  update app.customers c
  set last_activity_at = greatest(coalesce(c.last_activity_at, '-infinity'), a.latest)
  from (
    select m.customer_id, max(m.created_at) as latest
    from app.movements m
    where m.kind in ('purchase', 'redemption')
    group by m.customer_id
  ) a
  where c.id = a.customer_id
    and c.last_activity_at is distinct from greatest(coalesce(c.last_activity_at, '-infinity'), a.latest);
end;
$$;

revoke execute on function private.backfill_customer_activity() from public, anon, authenticated;

select private.backfill_customer_activity();

-- No write grant: app.customers stays written only by the RPCs (update and insert were
-- revoked from authenticated and anon in the customers migration), and this column only by
-- the trigger above.
