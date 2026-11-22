import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkHref, messagesTo, waitForMessageTo } from '../../e2e/mailpit';
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

const admin = account('funzione-admin', 'Funzione Admin');
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
  await Promise.all([admin, operator, device].map(createUser));
  admin.id = runSql(`select private.add_operator(:'email', :'name', 'admin');`, {
    email: admin.email,
    name: admin.name,
  });
  operator.id = runSql(`select private.add_operator(:'email', :'name', 'operator');`, {
    email: operator.email,
    name: operator.name,
  });
  device.id = runSql(`select private.add_device(:'email', :'name');`, {
    email: device.email,
    name: device.name,
  });
  await Promise.all([admin, operator, device].map(signIn));
}, 40_000);

afterAll(async () => {
  // The invites of this run: their reservations, profiles and Auth users, then the callers.
  const invitedUsers = runSql(
    `select coalesce(string_agg(u.id::text, ','), '') from auth.users u
     where lower(u.email) like 'invitato-%-' || :'run' || '@example.com';`,
    { run },
  )
    .split(',')
    .filter(Boolean);
  runSql(
    `delete from private.operator_invites where requested_by = nullif(:'admin', '')::uuid;
     delete from app.operators where invited_by = nullif(:'admin', '')::uuid;
     delete from app.devices where name = :'device';
     delete from app.operators where id = any(array[nullif(:'operator', ''), nullif(:'admin', '')]::uuid[]);`,
    { device: device.name, operator: operator.id, admin: admin.id },
  );
  await Promise.all(
    [...invitedUsers, ...[admin, operator, device].map((of) => of.userId).filter(Boolean)].map(
      (id) => secret.auth.admin.deleteUser(id).catch(() => undefined),
    ),
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
    const adminInvite = inviteBody('admin-da-operatore', 'admin');
    const authorization = `Bearer ${tokenOf(operator)}`;
    const answers = await Promise.all([
      call(invite, authorization),
      call(adminInvite, authorization),
      call({ action: 'resend', operator_id: operator.id }, authorization),
      call({ action: 'cancel', operator_id: operator.id }, authorization),
    ]);
    expect(answers).toEqual(answers.map(() => ({ status: 403, body: { error: 'forbidden' } })));
    await expectNoTrace(invite, since);
    await expectNoTrace(adminInvite, since);
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

/** Status, role, inviter and Auth metadata of the profiles with `name` (one row per profile). */
function profilesNamed(name: string): string[] {
  const rows = runSql(
    `select coalesce(string_agg(
       r.status || '|' || r.role || '|' || coalesce(o.invited_by::text, '') || '|' ||
       (o.invited_at is not null)::text || '|' ||
       coalesce(u.raw_user_meta_data ->> 'name', '') || '|' ||
       coalesce(u.raw_user_meta_data ->> 'invited_by', '') || '|' ||
       coalesce(u.raw_user_meta_data ->> 'role_label', ''), E'\\n'), '')
     from app.operators o
     cross join lateral private.operator_rows(o.id) r
     left join auth.users u on u.id = o.user_id
     where o.name = :'name';`,
    { name },
  );
  return rows === '' ? [] : rows.split('\n');
}

/** Waits a little longer than an email takes to arrive, then returns every email to `email`. */
async function settledMessagesTo(email: string, since: Date) {
  await waitForMessageTo(email, since);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return messagesTo(email, since);
}

describe('operator-invites served locally: the real invite email (Mailpit)', () => {
  it('an admin invites an admin: one email, one invited profile, metadata and link of the spec', async () => {
    const since = new Date();
    const body = { ...inviteBody('reale', 'admin'), name: `Zoë & <b>Co</b> ${run}` };
    const answer = await call(body, `Bearer ${tokenOf(admin)}`);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      status: 'invited',
      operator: { name: body.name, role: 'admin' },
    });

    expect(profilesNamed(body.name)).toEqual([
      `invited|admin|${admin.id}|true|${body.name}|${admin.name}|amministratore`,
    ]);

    const messages = await settledMessagesTo(body.email, since);
    expect(messages).toHaveLength(1);
    const [message] = messages;
    if (!message) throw new Error('no email');
    expect(message.subject).toBe('Enjoy Card: il tuo invito');
    // html/template escapes the name in the text: it can never become markup.
    expect(message.html).toContain('Ciao Zoë &amp; &lt;b&gt;Co&lt;/b&gt;');
    expect(message.html).not.toContain('<b>Co</b>');
    const text = message.html.replace(/\s+/g, ' ');
    expect(text).toContain(
      `${admin.name} ti ha invitato come amministratore dell’Enjoy Card, la fidelity card dell’Enjoy Bar.`,
    );
    expect(text).toContain('il link vale un’ora e si usa una volta sola.');
    expect(message.html).not.toMatch(/<img\b/i);

    const link = new URL(linkHref(message.html, 'Scegli la password'));
    expect(`${link.origin}${link.pathname}`).toBe(`${ORIGIN}/imposta-password`);
    expect(link.searchParams.get('type')).toBe('invite');
    const tokenHash = link.searchParams.get('token_hash');
    expect(tokenHash).toMatch(/^[0-9a-f]{20,}$/);
    const fragment = new URLSearchParams(link.hash.slice(1));
    expect(Object.fromEntries(fragment)).toEqual({
      nome: body.name,
      da: admin.name,
      ruolo: 'amministratore',
    });

    // The link is a real invite token for this person.
    const invitee = memoryClient(local.url, local.publishableKey);
    const { data, error } = await invitee.auth.verifyOtp({
      type: 'invite',
      token_hash: tokenHash ?? '',
    });
    expect(error).toBeNull();
    expect(data.user?.email).toBe(body.email);
  });

  it('the same operation_id twice in a row: one email, one profile, the same operator', async () => {
    const since = new Date();
    const body = inviteBody('ripetuto');
    const authorization = `Bearer ${tokenOf(admin)}`;
    const first = await call(body, authorization);
    const second = await call(body, authorization);
    expect(first.status).toBe(200);
    expect(second).toEqual(first);
    expect(await settledMessagesTo(body.email, since)).toHaveLength(1);
    expect(profilesNamed(body.name)).toHaveLength(1);
  });

  it('the same operation_id twice in parallel: one email, one profile', async () => {
    const since = new Date();
    const body = inviteBody('parallelo');
    const authorization = `Bearer ${tokenOf(admin)}`;
    const answers = await Promise.all([call(body, authorization), call(body, authorization)]);
    const statuses = answers.map((answer) => answer.status).toSorted((a, b) => a - b);
    // Both done, or one done and the other told the same invite is still running.
    expect([
      [200, 200],
      [200, 409],
    ]).toContainEqual(statuses);
    for (const answer of answers.filter((a) => a.status === 409)) {
      expect(answer.body).toEqual({ error: 'in_progress' });
    }
    expect(await settledMessagesTo(body.email, since)).toHaveLength(1);
    expect(profilesNamed(body.name)).toHaveLength(1);
    // Once the first has finished, the retry gets the same operator.
    const retry = await call(body, authorization);
    expect(retry.status).toBe(200);
    expect(profilesNamed(body.name)).toHaveLength(1);
    expect(await messagesTo(body.email, since)).toHaveLength(1);
  });

  it('the email of the tablet account: 409 email_is_device, no email', async () => {
    const since = new Date();
    const body = { ...inviteBody('tablet'), email: device.email };
    const answer = await call(body, `Bearer ${tokenOf(admin)}`);
    expect(answer).toEqual({ status: 409, body: { error: 'email_is_device' } });
    expect(profilesNamed(body.name)).toEqual([]);
    expect(await messagesTo(device.email, since)).toEqual([]);
  });

  it('a name already used: 409 name_taken, no email, no profile', async () => {
    const since = new Date();
    const body = { ...inviteBody('nome-usato'), name: operator.name };
    const answer = await call(body, `Bearer ${tokenOf(admin)}`);
    expect(answer).toEqual({ status: 409, body: { error: 'name_taken' } });
    // The refused reservation stays written (begin answers in jsonb); no Auth user, no email.
    expect(
      runSql(`select count(*) from auth.users where lower(email) = lower(:'email');`, {
        email: body.email,
      }),
    ).toBe('0');
    expect(await messagesTo(body.email, since)).toEqual([]);
    expect(profilesNamed(operator.name)).toHaveLength(1);
  });

  it('the email of an account: 409 email_taken, no email', async () => {
    const since = new Date();
    const body = { ...inviteBody('email-usata'), email: operator.email };
    const answer = await call(body, `Bearer ${tokenOf(admin)}`);
    expect(answer).toEqual({ status: 409, body: { error: 'email_taken', deactivated: false } });
    expect(profilesNamed(body.name)).toEqual([]);
    expect(await messagesTo(operator.email, since)).toEqual([]);
  });
});

/** The token_hash and type of the "Scegli la password" link of an email. */
function linkToken(html: string): { tokenHash: string; type: string | null } {
  const link = new URL(linkHref(html, 'Scegli la password'));
  expect(`${link.origin}${link.pathname}`).toBe(`${ORIGIN}/imposta-password`);
  const tokenHash = link.searchParams.get('token_hash');
  if (!tokenHash) throw new Error('no token_hash in the link');
  return { tokenHash, type: link.searchParams.get('type') };
}

/** Invites `body` as the admin and returns the new operator id and the token of its email. */
async function invited(
  body: ReturnType<typeof inviteBody>,
): Promise<{ id: string; tokenHash: string }> {
  const since = new Date();
  const answer = await call(body, `Bearer ${tokenOf(admin)}`);
  expect(answer.status).toBe(200);
  const { body: answered } = answer;
  const profile =
    typeof answered === 'object' && answered !== null && 'operator' in answered
      ? answered.operator
      : null;
  const id = typeof profile === 'object' && profile !== null && 'id' in profile ? profile.id : null;
  if (typeof id !== 'string') throw new Error('no operator id in the answer');
  const messages = await settledMessagesTo(body.email, since);
  expect(messages).toHaveLength(1);
  const [message] = messages;
  if (!message) throw new Error('no email');
  const { tokenHash, type } = linkToken(message.html);
  expect(type).toBe('invite');
  return { id, tokenHash };
}

/** Status of the profile `id` by the rule of SPEC-operators point 2. */
function statusOf(id: string): string {
  return runSql(`select status from private.operator_rows(:'id'::uuid);`, { id });
}

describe('operator-invites served locally: resend and cancel for real (Mailpit)', () => {
  it('a resend: a new invite email, the old token answers otp_expired, the new one works', async () => {
    const body = inviteBody('reinvio');
    const first = await invited(body);

    const since = new Date();
    const answer = await call(
      { action: 'resend', operator_id: first.id },
      `Bearer ${tokenOf(admin)}`,
    );
    expect(answer).toEqual({ status: 200, body: { status: 'resent' } });
    const messages = await settledMessagesTo(body.email, since);
    expect(messages).toHaveLength(1);
    const [message] = messages;
    if (!message) throw new Error('no email');
    expect(message.subject).toBe('Enjoy Card: il tuo invito');
    const second = linkToken(message.html);
    expect(second.type).toBe('invite');
    expect(second.tokenHash).not.toBe(first.tokenHash);

    const old = await memoryClient(local.url, local.publishableKey).auth.verifyOtp({
      type: 'invite',
      token_hash: first.tokenHash,
    });
    expect(old.error?.code).toBe('otp_expired');

    expect(statusOf(first.id)).toBe('invited');
    const invitee = memoryClient(local.url, local.publishableKey);
    const fresh = await invitee.auth.verifyOtp({ type: 'invite', token_hash: second.tokenHash });
    expect(fresh.error).toBeNull();
    expect(fresh.data.user?.email).toBe(body.email);
  });

  // Criterion 9 and point 2: GoTrue (signupVerify) gives every invited user without a password a
  // random temporary one when the invite token is verified, so "email confirmed and a password"
  // alone reads that person as active. The invite counts as accepted only once the person saves
  // a password of their own (app.operators.invite_accepted_at, Open Questions 12).
  it('a token verified without saving the password: still invited, the resend sends a recovery link that works', async () => {
    const body = inviteBody('senza-password');
    const first = await invited(body);
    expect(statusOf(first.id)).toBe('invited');

    // The person opens the link and leaves before saving a password.
    const opened = await memoryClient(local.url, local.publishableKey).auth.verifyOtp({
      type: 'invite',
      token_hash: first.tokenHash,
    });
    expect(opened.error).toBeNull();
    expect(
      runSql(
        `select (email_confirmed_at is not null)::text || ',' ||
                (coalesce(encrypted_password, '') <> '')::text
         from auth.users where lower(email) = lower(:'email');`,
        { email: body.email },
      ),
    ).toBe('true,true');
    expect(statusOf(first.id)).toBe('invited');

    // The email is confirmed: Auth refuses an invite, the resend sends the recovery link.
    const since = new Date();
    const answer = await call(
      { action: 'resend', operator_id: first.id },
      `Bearer ${tokenOf(admin)}`,
    );
    expect(answer).toEqual({ status: 200, body: { status: 'resent' } });
    const messages = await settledMessagesTo(body.email, since);
    expect(messages).toHaveLength(1);
    const [message] = messages;
    if (!message) throw new Error('no email');
    const link = linkToken(message.html);
    expect(link.type).toBe('recovery');
    const invitee = memoryClient(local.url, local.publishableKey);
    const verified = await invitee.auth.verifyOtp({ type: 'recovery', token_hash: link.tokenHash });
    expect(verified.error).toBeNull();
    expect(statusOf(first.id)).toBe('invited');

    // Saving the password accepts the invite: active, no resend any more.
    const saved = await invitee.auth.updateUser({
      password: randomBytes(18).toString('base64url'),
    });
    expect(saved.error).toBeNull();
    expect(statusOf(first.id)).toBe('active');
    const again = await call(
      { action: 'resend', operator_id: first.id },
      `Bearer ${tokenOf(admin)}`,
    );
    expect(again).toEqual({ status: 409, body: { error: 'not_invited' } });
  });

  // Point 5, step 2: an Auth user made in the dashboard (confirmed, with a password) and never
  // linked. The function replaces the password with a random one: nobody knows it, so the person
  // is invited until they choose their own, and the invite can be resent or cancelled.
  it('an email whose Auth user is confirmed with a password: invited, resend and cancel work', async () => {
    const body = inviteBody('confermato', 'admin');
    const created = await secret.auth.admin.createUser({
      email: body.email,
      password: randomBytes(18).toString('base64url'),
      email_confirm: true,
    });
    expect(created.error).toBeNull();

    const since = new Date();
    const answer = await call(body, `Bearer ${tokenOf(admin)}`);
    expect(answer.status).toBe(200);
    const { body: answered } = answer;
    const profile =
      typeof answered === 'object' && answered !== null && 'operator' in answered
        ? answered.operator
        : null;
    const id =
      typeof profile === 'object' && profile !== null && 'id' in profile ? profile.id : null;
    if (typeof id !== 'string') throw new Error('no operator id in the answer');
    const [message] = await settledMessagesTo(body.email, since);
    if (!message) throw new Error('no email');
    expect(linkToken(message.html).type).toBe('recovery');
    expect(statusOf(id)).toBe('invited');

    const resent = await call({ action: 'resend', operator_id: id }, `Bearer ${tokenOf(admin)}`);
    expect(resent).toEqual({ status: 200, body: { status: 'resent' } });
    const cancelled = await call({ action: 'cancel', operator_id: id }, `Bearer ${tokenOf(admin)}`);
    expect(cancelled).toEqual({ status: 200, body: { status: 'cancelled' } });
    expect(statusOf(id)).toBe('removed');
  });

  it('a cancel: the link already sent stops working, the profile is removed, a new invite relinks it', async () => {
    const body = inviteBody('annullato');
    const first = await invited(body);
    const movementsBefore = runSql(`select count(*) from app.movements;`);

    const answer = await call(
      { action: 'cancel', operator_id: first.id },
      `Bearer ${tokenOf(admin)}`,
    );
    expect(answer).toEqual({ status: 200, body: { status: 'cancelled' } });
    expect(statusOf(first.id)).toBe('removed');
    expect(
      runSql(`select count(*) from auth.users where lower(email) = lower(:'email');`, {
        email: body.email,
      }),
    ).toBe('0');

    const stale = await memoryClient(local.url, local.publishableKey).auth.verifyOtp({
      type: 'invite',
      token_hash: first.tokenHash,
    });
    expect(stale.error).not.toBeNull();
    expect(stale.data.user).toBeNull();

    // A second cancel finds nobody to cancel.
    const again = await call(
      { action: 'cancel', operator_id: first.id },
      `Bearer ${tokenOf(admin)}`,
    );
    expect(again).toEqual({ status: 409, body: { error: 'not_invited' } });

    // The right email with the same name relinks the removed profile: same id, invited again.
    const right = { ...inviteBody('annullato-giusta'), name: body.name };
    const relinked = await invited(right);
    expect(relinked.id).toBe(first.id);
    expect(statusOf(first.id)).toBe('invited');
    expect(profilesNamed(body.name)).toHaveLength(1);
    expect(
      runSql(
        `select lower(u.email) from app.operators o join auth.users u on u.id = o.user_id
         where o.id = :'id'::uuid;`,
        { id: first.id },
      ),
    ).toBe(right.email.toLowerCase());
    expect(runSql(`select count(*) from app.movements;`)).toBe(movementsBefore);
  });
});
