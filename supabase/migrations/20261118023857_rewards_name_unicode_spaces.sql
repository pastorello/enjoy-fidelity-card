-- Reward names: leading and trailing whitespace is any Unicode space, not only U+0020.
--
-- btrim() strips plain spaces only, so 'Caffè' followed by a no-break space (U+00A0, U+202F:
-- common in names pasted from chats) or a tab passed the table check and was saved as a second
-- 'Caffè' that rewards_name_key did not catch. The app trims with String.trim(), which strips
-- every Unicode space: the server now does the same, in both RPCs and in the table check.
-- Inner spaces are kept as typed (SPEC-rewards: only leading and trailing spaces are removed).

create function private.trim_spaces(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(p_text, '^\s+|\s+$', '', 'g');
$$;

revoke execute on function private.trim_spaces(text) from public, anon, authenticated;

-- Rows saved with outer Unicode spaces before this change are trimmed first; one that would
-- then repeat another name stops the migration on rewards_name_key, to be fixed by hand.
update app.rewards set name = private.trim_spaces(name) where name <> private.trim_spaces(name);

alter table app.rewards
  drop constraint rewards_name_check,
  add constraint rewards_name_check
    check (name = private.trim_spaces(name) and length(name) between 1 and 60);

-- create_reward and update_reward: the bodies of 20261118023602 and of the rewards migration,
-- with private.trim_spaces() in place of btrim().
create or replace function app.create_reward(p_id uuid, p_name text, p_points int, p_active boolean)
returns app.rewards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
  v_name text := private.trim_spaces(p_name);
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

create or replace function app.update_reward(p_id uuid, p_name text, p_points int)
returns app.rewards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
  v_name text := private.trim_spaces(p_name);
  v_row app.rewards;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can change the rewards' using errcode = '42501';
  end if;
  v_author := private.acting_operator_id();
  if v_author is null then
    raise exception 'No acting operator for this write' using errcode = '42501';
  end if;

  perform 1 from app.rewards where id = p_id for update;
  if not found then
    raise exception 'Reward % not found', p_id using errcode = 'P0002';
  end if;

  if v_name is null or length(v_name) not between 1 and 60 then
    raise exception 'name must be 1 to 60 characters' using errcode = '23514';
  end if;
  if p_points is null or p_points not between 1 and 99999 then
    raise exception 'points must be between 1 and 99999, got %', p_points using errcode = '23514';
  end if;

  -- A taken name raises 23505 on rewards_name_key.
  update app.rewards
  set name = v_name, points = p_points, updated_at = now(), updated_by = v_author
  where id = p_id
  returning * into strict v_row;
  return v_row;
end;
$$;
