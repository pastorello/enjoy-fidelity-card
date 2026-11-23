import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localSupabase, memoryClient, runSql } from './localSupabase';

// customers-v2 over HTTP (SPEC-customers-v2.md, criteria 5 and 7): the home list paged through
// PostgREST with the cursor sent back as received, and the rewards of the public page for anon.
// Card races (criterion 8) are in cards.test.ts, next to the other card races.

const local = localSupabase();
// Seed accounts (supabase/seed.sql): signing in does not change them.
const SEED_PASSWORD = 'password-di-prova';
// Customers are never deleted: every run uses names of its own, so it repeats without db:reset.
const SUFFIX = randomBytes(4).toString('hex');

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = memoryClient(local.url, local.publishableKey);
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

type Answer = { status: number; cacheControl: string | null; body: string };

/**
 * POSTs an RPC over plain HTTP and returns the raw answer, read as text before any parsing: a test
 * can look for strings that must never leave the server. No client means the anon key alone.
 */
async function rawRpc(
  client: SupabaseClient | null,
  schema: 'app' | 'public',
  fn: string,
  args: Record<string, unknown>,
): Promise<Answer> {
  const headers: Record<string, string> = {
    apikey: local.publishableKey,
    'Content-Type': 'application/json',
    'Content-Profile': schema,
    Accept: 'application/json',
  };
  if (client) {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('No session for this client');
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${local.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: await response.text(),
  };
}

/** Setup and teardown steps must work: a failed one stops the hook, without an expect. */
function succeeded(answer: Answer, what: string): Answer {
  if (answer.status !== 200) throw new Error(`${what} answered ${answer.status}`);
  return answer;
}

function rowsOf(body: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) throw new Error('An RPC body is not an array');
  return parsed.map((row: unknown) => {
    if (typeof row !== 'object' || row === null) throw new Error('An RPC row is not an object');
    return Object.fromEntries(Object.entries(row));
  });
}

/** A field PostgREST sent as a string (ids and timestamps): never re-encoded by the test. */
function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string') throw new Error(`Field ${field} is not a string`);
  return value;
}

/** The next cursor of `list_customers`, built only from the strings of the last row received. */
function cursorAfter(row: Record<string, unknown>): Record<string, unknown> {
  return {
    p_after_activity_at: row.last_activity_at ?? null,
    p_after_created_at: text(row, 'created_at'),
    p_after_id: text(row, 'id'),
  };
}

/** Every page of `list_customers` over HTTP, the cursor sent back exactly as received. */
async function allPages(
  client: SupabaseClient,
  query: string | null,
  limit: number,
): Promise<Record<string, unknown>[][]> {
  const pages: Record<string, unknown>[][] = [];
  let cursor: Record<string, unknown> = {};
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the cursor of the one before it.
    const answer = await rawRpc(client, 'app', 'list_customers', {
      p_query: query,
      p_limit: limit,
      ...cursor,
    });
    expect(answer.status).toBe(200);
    const rows = rowsOf(answer.body);
    pages.push(rows);
    const last = rows.at(-1);
    if (!last || rows.length < limit) return pages;
    cursor = cursorAfter(last);
  }
}

/** Customers this run leaves readable: anonymized at the end. */
const toErase: string[] = [];

let adminClient: SupabaseClient;
let operatorClient: SupabaseClient;

beforeAll(async () => {
  adminClient = await signedIn('admin@example.com');
  operatorClient = await signedIn('operatore@example.com');
});

afterAll(async () => {
  const answers = await Promise.all(
    toErase.map((id) => rawRpc(adminClient, 'app', 'anonymize_customer', { p_customer_id: id })),
  );
  for (const answer of answers) succeeded(answer, 'anonymize_customer');
});

describe('list_customers over PostgREST (criterion 5)', () => {
  // 45 customers of this run: 20 + 20 + 5 rows, so three pages. Three customers share each
  // creation time and two each activity time, all within one millisecond: only the id tells them
  // apart, and a cursor rounded to milliseconds (a JavaScript Date) would skip or repeat rows.
  const COUNT = 45;
  const PREFIX = `Lista ${SUFFIX}`;
  type Fixture = { id: string; name: string; createdOffset: number; activityOffset: number | null };
  const fixtures: Fixture[] = Array.from({ length: COUNT }, (_, index) => ({
    id: randomUUID(),
    name: `${PREFIX} ${String(index).padStart(2, '0')}`,
    createdOffset: Math.floor(index / 3),
    activityOffset: index % 3 === 0 ? Math.floor(index / 6) : null,
  }));
  // The same order as the server, from the fixtures alone: activity first, latest first, id last.
  const expected = fixtures
    .toSorted(
      (a, b) =>
        Number(b.activityOffset !== null) - Number(a.activityOffset !== null) ||
        (b.activityOffset ?? b.createdOffset) - (a.activityOffset ?? a.createdOffset) ||
        (a.id < b.id ? 1 : -1),
    )
    .map((fixture) => fixture.id);
  const erasedId = randomUUID();

  beforeAll(async () => {
    // Inserted as the database owner: the RPCs cannot backdate created_at or last_activity_at.
    runSql(
      `insert into app.customers
         (id, name, privacy_consent_at, created_by, create_operation_id, created_at, last_activity_at)
       select r.id, r.name, now(), o.id, gen_random_uuid(),
              timestamptz '2001-02-03 04:05:06.000100+00' + r.created_offset * interval '1 microsecond',
              timestamptz '2001-02-03 04:05:06.000500+00' + r.activity_offset * interval '1 microsecond'
       from json_to_recordset(:'rows'::json)
            as r (id uuid, name text, created_offset int, activity_offset int)
       cross join (select id from app.operators where name = 'Admin Prova') o;`,
      {
        rows: JSON.stringify([
          ...fixtures.map((fixture) => ({
            id: fixture.id,
            name: fixture.name,
            created_offset: fixture.createdOffset,
            activity_offset: fixture.activityOffset,
          })),
          // A customer whose data was erased matches the filter but is never listed.
          { id: erasedId, name: `${PREFIX} cancellato`, created_offset: 999, activity_offset: 999 },
        ]),
      },
    );
    toErase.push(...fixtures.map((fixture) => fixture.id));
    const erased = await rawRpc(adminClient, 'app', 'anonymize_customer', {
      p_customer_id: erasedId,
    });
    succeeded(erased, 'anonymize_customer');
  });

  it('the filtered list comes in three pages, in order, with no row lost or repeated', async () => {
    const pages = await allPages(operatorClient, PREFIX.toLowerCase(), 20);
    expect(pages.map((page) => page.length)).toEqual([20, 20, 5]);
    const ids = pages.flat().map((row) => text(row, 'id'));
    expect(ids).toEqual(expected);
    expect(ids).not.toContain(erasedId);
  });

  // Postgres drops trailing zeros: 04:05:06.0001 is 100 microseconds.
  it('timestamps come as microsecond strings and go back unchanged', async () => {
    const [first] = await allPages(operatorClient, PREFIX, 50);
    const withActivity = first?.find((row) => row.last_activity_at !== null);
    expect(withActivity?.last_activity_at).toMatch(/^2001-02-03T04:05:06\.0005\d{0,2}\+00:00$/);
    expect(text(first?.at(-1) ?? {}, 'created_at')).toMatch(
      /^2001-02-03T04:05:06\.0001\d{0,2}\+00:00$/,
    );
  });

  it('a row carries id, name, balance and the two times only: no email, notes or uid', async () => {
    const [first] = await allPages(operatorClient, PREFIX, 1);
    expect(Object.keys(first?.[0] ?? {}).toSorted()).toEqual([
      'balance',
      'created_at',
      'id',
      'last_activity_at',
      'name',
    ]);
  });

  it('the whole list, page by page, is every customer not erased, each once', async () => {
    const ids = (await allPages(operatorClient, null, 50)).flat().map((row) => text(row, 'id'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(String(ids.length)).toBe(
      runSql('select count(*) from app.customers where anonymized_at is null;'),
    );
    // Our 45 keep their relative order inside the whole list.
    const ours = new Set(expected);
    expect(ids.filter((id) => ours.has(id))).toEqual(expected);
  });

  it('a partial cursor is refused, never read as the end of the list', async () => {
    const answer = await rawRpc(operatorClient, 'app', 'list_customers', {
      p_after_id: expected[0],
    });
    expect(answer.status).toBe(400);
    expect(JSON.parse(answer.body)).toMatchObject({ code: '22023', message: 'invalid_cursor' });
  });
});

describe('card_rewards over HTTP with the anon key (criterion 7)', () => {
  const uid = `04${randomBytes(6).toString('hex').toUpperCase()}`;
  let token = '';
  let cardId = '';

  beforeAll(async () => {
    const customerId = randomUUID();
    runSql(
      `insert into app.customers (id, name, privacy_consent_at, created_by, create_operation_id)
       select :'id'::uuid, :'name', now(), id, gen_random_uuid()
       from app.operators where name = 'Operatore Prova';`,
      { id: customerId, name: `Premi ${SUFFIX}` },
    );
    toErase.push(customerId);
    const associated = await rawRpc(operatorClient, 'app', 'associate_card', {
      p_customer_id: customerId,
      p_uid: uid,
    });
    succeeded(associated, 'associate_card');
    cardId = text(rowsOf(`[${associated.body}]`)[0] ?? {}, 'id');
    const issued = await rawRpc(operatorClient, 'app', 'issue_card_link', { p_card_id: cardId });
    succeeded(issued, 'issue_card_link');
    const issuedToken: unknown = JSON.parse(issued.body);
    if (typeof issuedToken !== 'string') throw new Error('issue_card_link answered no token');
    token = issuedToken;
    const confirmed = await rawRpc(operatorClient, 'app', 'confirm_card_link', {
      p_card_id: cardId,
      p_token: token,
    });
    succeeded(confirmed, 'confirm_card_link');
  });

  it('a valid token answers the active rewards, cheapest first, name and points only', async () => {
    const answer = await rawRpc(null, 'public', 'card_rewards', { p_token: token });
    expect(answer).toMatchObject({ status: 200, cacheControl: 'no-store' });
    const active = runSql(
      `select coalesce(json_agg(json_build_object('name', name, 'points', points)
                                order by points, lower(name), id), '[]')
       from app.rewards where active;`,
    );
    expect(JSON.parse(answer.body)).toEqual(JSON.parse(active));
    expect(rowsOf(answer.body).length).toBeGreaterThan(0);
    for (const row of rowsOf(answer.body))
      expect(Object.keys(row).toSorted()).toEqual(['name', 'points']);
    expect(answer.body).not.toContain(token);
    expect(answer.body).not.toContain(uid);
    expect(answer.body).not.toContain(cardId);
  });

  it('a token that never existed, a malformed one and null all answer the same empty list', async () => {
    const tokens = [randomBytes(16).toString('base64url'), token.slice(1), `${token}A`, null];
    const answers = await Promise.all(
      tokens.map((candidate) => rawRpc(null, 'public', 'card_rewards', { p_token: candidate })),
    );
    expect(answers).toEqual(
      tokens.map(() => ({ status: 200, cacheControl: 'no-store', body: '[]' })),
    );
  });

  it('after the card is deactivated the same token answers the empty list too', async () => {
    const before = await rawRpc(null, 'public', 'card_rewards', { p_token: token });
    expect(rowsOf(before.body).length).toBeGreaterThan(0);
    const deactivated = await rawRpc(operatorClient, 'app', 'deactivate_card', {
      p_card_id: cardId,
    });
    expect(deactivated.status).toBe(200);
    const after = await rawRpc(null, 'public', 'card_rewards', { p_token: token });
    expect(after).toEqual({ status: 200, cacheControl: 'no-store', body: '[]' });
  });

  it('anon executes none of the new app RPCs, and no refusal echoes the arguments', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['list_customers', {}],
      ['get_card', { p_card_id: cardId }],
      ['reactivate_card', { p_card_id: cardId, p_expected_active_card_id: null }],
      ['release_card', { p_operation_id: randomUUID(), p_card_id: cardId }],
    ];
    const answers = await Promise.all(calls.map(([fn, args]) => rawRpc(null, 'app', fn, args)));
    for (const answer of answers) {
      expect(answer.status).toBeGreaterThanOrEqual(400);
      expect(answer.body).not.toContain(cardId);
      expect(answer.body).not.toContain(uid);
    }
    expect(
      runSql(`select active, released_at is null from app.cards where id = :'id'::uuid;`, {
        id: cardId,
      }),
    ).toBe('f|t');
  });
});
