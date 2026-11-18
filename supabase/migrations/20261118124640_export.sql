-- export V1 (docs/specs/SPEC-export.md, "Modello dati e regole di accesso"):
-- read-only RPCs that feed the CSV files an admin downloads from the settings.
-- The role is checked here, on the server; the personal data of anonymized
-- customers never leaves the database. No table is added.

-- export_customers -----------------------------------------------------------------------
-- Every customer, anonymized ones included, in pages ordered by id (keyset: the
-- rows after p_after_id, or from the start when it is null). The client sorts by
-- name. balance_points has a single definition, private.customer_balance.
create function app.export_customers(p_after_id uuid default null, p_limit int default 1000)
returns table (
  id uuid,
  name text,
  phone text,
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

-- export_movements -----------------------------------------------------------------------
-- The whole history, oldest first, in pages ordered by (created_at, id) (keyset: the
-- rows after the cursor, or from the start when both cursor fields are null; the
-- index movements_created_idx of ledger serves it). customer_name is the current
-- name of the customer, null once anonymized; description falls back to the reward
-- name; corrected_by_movement_id is the correction pointing at the row, if any
-- (corrects_movement_id is unique, so there is at most one).
create function app.export_movements(
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit int default 1000
)
returns table (
  id uuid,
  created_at timestamptz,
  customer_id uuid,
  customer_name text,
  kind text,
  amount_cents int,
  points int,
  cents_per_point int,
  description text,
  operator_name text,
  corrects_movement_id uuid,
  corrected_by_movement_id uuid
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
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'invalid_cursor' using errcode = '22023';
  end if;

  return query
    select
      m.id,
      m.created_at,
      m.customer_id,
      case when c.anonymized_at is null then c.name end,
      m.kind,
      m.amount_cents,
      m.points,
      m.cents_per_point,
      coalesce(m.description, r.name),
      o.name,
      m.corrects_movement_id,
      corr.id
    from app.movements m
    join app.customers c on c.id = m.customer_id
    join app.operators o on o.id = m.operator_id
    left join app.rewards r on r.id = m.reward_id
    left join app.movements corr on corr.corrects_movement_id = m.id
    where p_after_created_at is null
       or (m.created_at, m.id) > (p_after_created_at, p_after_id)
    order by m.created_at, m.id
    limit p_limit;
end;
$$;

revoke execute on function app.export_movements(timestamptz, uuid, int) from public, anon;
grant execute on function app.export_movements(timestamptz, uuid, int) to authenticated;
