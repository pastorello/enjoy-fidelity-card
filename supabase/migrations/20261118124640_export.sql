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
