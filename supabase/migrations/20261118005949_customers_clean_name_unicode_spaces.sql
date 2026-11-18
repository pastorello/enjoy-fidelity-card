-- clean_name: collapse first, then trim. The first version trimmed only ASCII whitespace
-- before collapsing, so a name ending in a non-breaking space (U+00A0, U+202F: common in
-- names pasted from contacts or chats) came out with a trailing plain space and failed the
-- table's own check with a raw 23514 instead of being saved trimmed.
--
-- Every row valid under the old body is unchanged by the new one (its whitespace runs were
-- already single plain spaces, with none at the ends), so the stored names and name keys
-- stay the same; the check is re-added to prove it on the existing rows.

create or replace function private.clean_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(p_name, '\s+', ' ', 'g'), ' ');
$$;

alter table app.customers
  drop constraint customers_name_check,
  add constraint customers_name_check
    check (name = private.clean_name(name) and length(name) between 1 and 80);

do $$
begin
  if exists (
    select 1 from app.customers where name_key is distinct from private.customer_name_key(name)
  ) then
    raise exception 'customers.name_key out of date after the clean_name change';
  end if;
end;
$$;
