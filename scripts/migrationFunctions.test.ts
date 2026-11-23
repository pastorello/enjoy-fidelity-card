import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { liveFunctions, liveFunctionsIn, raisedMessageCodes } from './migrationFunctions';

// Made-up migrations: a function replaced, one dropped for good, one dropped and recreated with a
// new signature, the way SPEC-customers-v2 replaces the phone parameter with p_email.
const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
writeFileSync(
  join(dir, '20260101000000_customers.sql'),
  `create function app.create_customer(p_old text) returns void language plpgsql as $$
begin
  raise exception 'old_invalid' using errcode = 'P0001';
  raise exception 'name_required' using errcode = 'P0001';
end $$;

create function app.search_customers(p_query text) returns void language plpgsql as $$
begin
  raise exception 'not_operator' using errcode = 'P0001';
end $$;

create function private.normalize_old(p text) returns text language sql as $$ select p $$;
`,
);
writeFileSync(
  join(dir, '20260102000000_customers_v2_email.sql'),
  `-- drop function app.get_customer(uuid);  (a comment, not a statement)
drop function app.create_customer(text);

create function app.create_customer(p_email text) returns void language plpgsql as $$
begin
  raise exception 'email_invalid' using errcode = 'P0001';
  raise exception 'name_required' using errcode = 'P0001';
  raise exception 'invalid_limit' using errcode = '22023';
end $$;

drop function app.search_customers(text);
drop function if exists private.normalize_old(text);
`,
);
writeFileSync(
  join(dir, '20260103000000_cards.sql'),
  `create or replace function app.lookup_card(p_uid text) returns void language plpgsql as $$
begin
  raise exception 'invalid_uid' using errcode = 'P0001';
end $$;
`,
);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('live functions of the migrations', () => {
  it('keeps only the functions still present, each with its latest definition', () => {
    const live = liveFunctions(dir).map((fn) => `${fn.name} @ ${fn.file}`);
    expect(live.toSorted((a, b) => a.localeCompare(b))).toEqual([
      'app.create_customer @ 20260102000000_customers_v2_email.sql',
      'app.lookup_card @ 20260103000000_cards.sql',
    ]);
  });

  it('raises only the P0001 codes of the latest definitions', () => {
    const customers = liveFunctionsIn(/_customers[a-z0-9_]*\.sql$/, dir);
    expect(raisedMessageCodes(customers)).toEqual(['email_invalid', 'name_required']);
  });

  it('refuses a pattern that matches no live function', () => {
    expect(() => liveFunctionsIn(/_ledger\.sql$/, dir)).toThrow(/no live function/);
  });
});
