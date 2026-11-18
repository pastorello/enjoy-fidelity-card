-- create_reward: a resend that races the first request returns the first row.
--
-- 'on conflict (id) do nothing' covers a resend that finds the first request's row in the
-- primary key. When the resend checks the primary key just before the first request writes
-- its entry, the insert goes on and meets the first row in rewards_name_key instead (not an
-- arbiter of the on conflict clause): it waits for it and raised 23505, which the app shows
-- as "name already taken" for the admin's own reward. The insert now catches that error and
-- returns the row with the same id when it exists; any other duplicate is raised as before.
-- Only the insert changes; the rest of the body is the one of the rewards migration.

create or replace function app.create_reward(p_id uuid, p_name text, p_points int, p_active boolean)
returns app.rewards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
  v_name text := btrim(p_name);
  v_row app.rewards;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can change the rewards' using errcode = '42501';
  end if;
  v_author := private.acting_operator_id();
  if v_author is null then
    raise exception 'No acting operator for this write' using errcode = '42501';
  end if;

  -- A resent request: return what the first one created.
  select * into v_row from app.rewards where id = p_id;
  if found then
    return v_row;
  end if;

  if p_id is null then
    raise exception 'id is required' using errcode = '23514';
  end if;
  if v_name is null or length(v_name) not between 1 and 60 then
    raise exception 'name must be 1 to 60 characters' using errcode = '23514';
  end if;
  if p_points is null or p_points not between 1 and 99999 then
    raise exception 'points must be between 1 and 99999, got %', p_points using errcode = '23514';
  end if;
  if p_active is null then
    raise exception 'active is required' using errcode = '23514';
  end if;

  -- Two concurrent requests with the same id make one row: the loser does nothing
  -- and reads the winner's row. A taken name raises 23505 on rewards_name_key.
  begin
    insert into app.rewards (id, name, points, active, created_by, updated_by)
    values (p_id, v_name, p_points, p_active, v_author, v_author)
    on conflict (id) do nothing;
  exception when unique_violation then
    -- The loser of a race on the same id can fail on the name before it sees the id:
    -- the winner has committed by now, so its row is visible to this new statement.
    select * into v_row from app.rewards where id = p_id;
    if found then
      return v_row;
    end if;
    raise;
  end;

  select * into strict v_row from app.rewards where id = p_id;
  return v_row;
end;
$$;
