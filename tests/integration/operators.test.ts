import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { messagesTo } from '../../e2e/mailpit';
import { localSupabase, memoryClient, runSql } from './localSupabase';

// SPEC-operators.md point 5: the Edge Function operator-invites served locally
// (`npx supabase functions serve`, APP_ORIGINS from supabase/functions/.env). The gateway lets the
// anon key through (a valid JWT): only the RPCs decide who may invite, so whoever is not an admin
// gets a refusal and leaves no trace: no reservation, no Auth user, no email. Every account is made
// here and removed at the end; the seed accounts reserved to the E2E are never touched.
const local = localSupabase();
const secret = memoryClient(local.url, local.secretKey);
const FUNCTION_URL = `${local.url}/functions/v1/operator-invites`;
const ORIGIN = 'http://localhost:5173';

const run = randomUUID().slice(0, 8);
type Account = { email: string; name: string; password: string; userId: string; id: string };

function account(label: string, name: string): Account {
  return {
    email: `${label}-${run}@example.com`,
    name: `${name} ${run}`,
    password: randomBytes(18).toString('base64url'),
    userId: '',
    id: '',
  };
}

const operator = account('funzione-operatore', 'Funzione Operatore');
const device = account('funzione-tablet', 'Funzione Tablet');
const tokens = new Map<Account, string>();

async function createUser(of: Account): Promise<void> {
  const { data, error } = await secret.auth.admin.createUser({
    email: of.email,
    password: of.password,
    email_confirm: true,
  });
  if (error) throw error;
  of.userId = data.user.id;
}

async function signIn(of: Account): Promise<void> {
  const client = memoryClient(local.url, local.publishableKey);
  const { data, error } = await client.auth.signInWithPassword({
    email: of.email,
    password: of.password,
  });
  if (error) throw error;
  tokens.set(of, data.session.access_token);
}

function tokenOf(of: Account): string {
  const token = tokens.get(of);
  if (!token) throw new Error(`${of.name} is not signed in`);
  return token;
}

type Answer = { status: number; body: unknown };

async function call(body: unknown, authorization: string | null): Promise<Answer> {
  const headers = new Headers({ 'Content-Type': 'application/json', Origin: ORIGIN });
  if (authorization !== null) headers.set('Authorization', authorization);
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON (a gateway page): kept as text for the assertion message.
  }
  return { status: response.status, body: parsed };
}

/** Each run invites a fresh email and name, so a trace can only come from this call. */
function inviteBody(label: string, role: 'admin' | 'operator' = 'operator') {
  return {
    action: 'invite',
    operation_id: randomUUID(),
    name: `Invitato ${label} ${run}`,
    email: `invitato-${label}-${run}@example.com`,
    role,
  };
}

/** No reservation, no Auth user, no email for this invite. */
async function expectNoTrace(body: ReturnType<typeof inviteBody>, since: Date): Promise<void> {
  const traces = runSql(
    `select (select count(*) from private.operator_invites where operation_id = :'op'::uuid)
         || ',' || (select count(*) from auth.users where lower(email) = lower(:'email'));`,
    { op: body.operation_id, email: body.email },
  );
  expect(traces).toBe('0,0');
  expect(await messagesTo(body.email, since)).toEqual([]);
}

/** The function answers once `functions serve` has booted it; a clear error otherwise. */
async function waitForFunction(deadline = Date.now() + 20_000): Promise<void> {
  try {
    const answer = await call(inviteBody('avvio'), null);
    if (answer.status === 401) return;
    throw new Error(`answered ${answer.status}`);
  } catch (error) {
    if (Date.now() > deadline) {
      throw new Error(
        'operator-invites is not served: run `npx supabase functions serve` ' +
          'with supabase/functions/.env copied from .env.example.',
        { cause: error },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    await waitForFunction(deadline);
  }
}

beforeAll(async () => {
  await waitForFunction();
  await Promise.all([operator, device].map(createUser));
  operator.id = runSql(`select private.add_operator(:'email', :'name', 'operator');`, {
    email: operator.email,
    name: operator.name,
  });
  device.id = runSql(`select private.add_device(:'email', :'name');`, {
    email: device.email,
    name: device.name,
  });
  await Promise.all([operator, device].map(signIn));
}, 40_000);

afterAll(async () => {
  runSql(
    `delete from app.devices where name = :'device';
     delete from app.operators where id = nullif(:'operator', '')::uuid;`,
    { device: device.name, operator: operator.id },
  );
  await Promise.all(
    [operator, device]
      .map((of) => of.userId)
      .filter(Boolean)
      .map((id) => secret.auth.admin.deleteUser(id).catch(() => undefined)),
  );
});

describe('operator-invites served locally: whoever is not an admin', () => {
  it('without a token: 401 from the gateway, no trace', async () => {
    const since = new Date();
    const body = inviteBody('senza-token');
    expect((await call(body, null)).status).toBe(401);
    await expectNoTrace(body, since);
  });

  it.each([
    ['the publishable key', () => local.publishableKey],
    ['the legacy anon JWT', () => local.anonKey],
  ])('with %s: 401 or 403, no trace', async (_label, anonToken) => {
    const since = new Date();
    const bodies = [inviteBody('anon'), inviteBody('anon-admin', 'admin')];
    const answers = await Promise.all(bodies.map((body) => call(body, `Bearer ${anonToken()}`)));
    for (const answer of answers) expect([401, 403]).toContain(answer.status);
    await Promise.all(bodies.map((body) => expectNoTrace(body, since)));
  });

  it('with the legacy anon JWT: the RPC refuses it, 403 forbidden', async () => {
    const answer = await call(inviteBody('anon-rpc'), `Bearer ${local.anonKey}`);
    expect(answer).toEqual({ status: 403, body: { error: 'forbidden' } });
  });

  it('an operator: 403 forbidden for every action, no trace', async () => {
    const since = new Date();
    const invite = inviteBody('da-operatore');
    const admin = inviteBody('admin-da-operatore', 'admin');
    const authorization = `Bearer ${tokenOf(operator)}`;
    const answers = await Promise.all([
      call(invite, authorization),
      call(admin, authorization),
      call({ action: 'resend', operator_id: operator.id }, authorization),
      call({ action: 'cancel', operator_id: operator.id }, authorization),
    ]);
    expect(answers).toEqual(answers.map(() => ({ status: 403, body: { error: 'forbidden' } })));
    await expectNoTrace(invite, since);
    await expectNoTrace(admin, since);
    expect(
      runSql(`select count(*) from app.operators where id = :'id'::uuid and user_id is not null;`, {
        id: operator.id,
      }),
    ).toBe('1');
  });

  it('a device without a cashier: 403 forbidden, no trace', async () => {
    const since = new Date();
    const invite = inviteBody('da-tablet');
    const authorization = `Bearer ${tokenOf(device)}`;
    const answers = await Promise.all([
      call(invite, authorization),
      call({ action: 'resend', operator_id: operator.id }, authorization),
      call({ action: 'cancel', operator_id: operator.id }, authorization),
    ]);
    expect(answers).toEqual(answers.map(() => ({ status: 403, body: { error: 'forbidden' } })));
    await expectNoTrace(invite, since);
  });

  it('a request from an origin not in APP_ORIGINS: 403 forbidden_origin', async () => {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Authorization: `Bearer ${tokenOf(operator)}` },
      body: JSON.stringify(inviteBody('origine')),
    });
    // No Allow-Origin check here: the local Kong gateway adds its own `*` to every answer (hosted
    // projects do not); handler.test.ts proves the function never sends one.
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden_origin' });
  });
});
