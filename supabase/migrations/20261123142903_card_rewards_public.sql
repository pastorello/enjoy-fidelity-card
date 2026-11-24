-- customers-v2: the active rewards on the public points page (SPEC-customers-v2.md §3).
-- The token check of card_points moves into private.card_customer_for_token, so
-- card_points and the new card_rewards cannot diverge: same format check, same
-- confirmed link, same active card, same customer not anonymized. card_points keeps
-- its signature, its integer result and its behaviour. card_rewards answers only
-- the name and points of the active rewards, and only for a valid token: every
-- other case is the same zero rows, never an error, so the answer never tells the
-- cases apart. Both write nothing and log nothing.

-- card_customer_for_token ------------------------------------------------------------------
-- The customer whose card is active and whose confirmed link is this token, or null.
-- Security invoker on purpose: it runs only inside the security definer functions
-- below, and nobody else may execute it.
create function private.card_customer_for_token(p_token text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_customer_id uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;

  select c.customer_id into v_customer_id
  from private.card_links l
  join app.cards c on c.id = l.card_id and c.active
  join app.customers cu on cu.id = c.customer_id and cu.anonymized_at is null
  where l.token_hash = private.card_token_hash(p_token);

  return v_customer_id;
end;
$$;

revoke execute on function private.card_customer_for_token(text) from public, anon, authenticated;

-- card_points ---------------------------------------------------------------------------------
-- Unchanged behaviour: an integer for a valid token, null for anything else.
create or replace function public.card_points(p_token text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
begin
  -- PostgREST turns this into a response header: no browser or proxy keeps it.
  perform set_config('response.headers', '[{"Cache-Control": "no-store"}]', true);

  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;

  v_customer_id := private.card_customer_for_token(p_token);
  if v_customer_id is null then
    return null;
  end if;

  return private.customer_balance(v_customer_id);
end;
$$;

revoke execute on function public.card_points(text) from public;
grant execute on function public.card_points(text) to anon, authenticated;

-- card_rewards --------------------------------------------------------------------------------
-- The active rewards (name and points only: no id, date or state), cheapest first,
-- for a valid token; zero rows otherwise. At most 100 rows.
create function public.card_rewards(p_token text)
returns table (name text, points int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- PostgREST turns this into a response header: no browser or proxy keeps it.
  perform set_config('response.headers', '[{"Cache-Control": "no-store"}]', true);

  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return;
  end if;

  if private.card_customer_for_token(p_token) is null then
    return;
  end if;

  return query
    select r.name, r.points
    from app.rewards r
    where r.active
    order by r.points, lower(r.name), r.id
    limit 100;
end;
$$;

revoke execute on function public.card_rewards(text) from public;
grant execute on function public.card_rewards(text) to anon, authenticated;
