// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { corsHeaders } from '@supabase/supabase-js/cors';
import { describe, expect, it } from 'vitest';
import { handle, type HandlerDeps, MAX_BODY_BYTES } from './handler.ts';

const APP = 'http://localhost:5173';
const PREVIEW = 'https://enjoy-fidelity-card-*-bar-team.vercel.app';
const TOKEN = 'Bearer header.payload.signature';
const OPERATION_ID = '6f1c2b0e-8a4d-4f7e-9c3a-1b2d3e4f5a6b';

/** Deps whose clients record any access: the boundary checks must not reach them. */
function trackedDeps(env: Partial<HandlerDeps['env']> = {}) {
  const touched: string[] = [];
  function untouchable(label: string): SupabaseClient {
    const target: SupabaseClient = Object.create(null);
    return new Proxy(target, {
      get(_target, property) {
        touched.push(`${label}.${String(property)}`);
        throw new Error(`${label} must not be used`);
      },
    });
  }
  const deps: HandlerDeps = {
    env: { APP_ORIGINS: `${APP}, http://localhost:4173`, ...env },
    callerClient: (authorization) => {
      touched.push(`callerClient(${authorization})`);
      return untouchable('caller');
    },
    adminClient: untouchable('admin'),
    log: () => undefined,
  };
  return { deps, touched };
}

function post(
  body: unknown,
  {
    origin = APP,
    authorization = TOKEN,
  }: { origin?: string | null; authorization?: string | null } = {},
): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (origin !== null) headers.set('Origin', origin);
  if (authorization !== null) headers.set('Authorization', authorization);
  return new Request('http://localhost:54321/functions/v1/operator-invites', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function preflight(origin: string): Request {
  return new Request('http://x/', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  });
}

const invite = {
  action: 'invite',
  operation_id: OPERATION_ID,
  name: 'Giulia',
  email: 'giulia@example.test',
  role: 'operator',
};

async function errorOf(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  return typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;
}

describe('origin', () => {
  it.each([
    ['an unknown origin', 'https://evil.example'],
    ['a look-alike of an allowed origin', 'http://localhost:51730'],
    ['the "null" origin', 'null'],
    [
      'a preview-like origin when no preview pattern is set',
      'https://enjoy-fidelity-card-abc-bar-team.vercel.app',
    ],
  ])('refuses %s with 403 forbidden_origin and no client call', async (_label, origin) => {
    const { deps, touched } = trackedDeps();
    const responses = await Promise.all([
      handle(post(invite, { origin }), deps),
      handle(preflight(origin), deps),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(response.headers.get('Vary')).toBe('Origin');
    }
    expect(await Promise.all(responses.map(errorOf))).toEqual([
      'forbidden_origin',
      'forbidden_origin',
    ]);
    expect(touched).toEqual([]);
  });

  it('refuses a request without Origin', async () => {
    const { deps, touched } = trackedDeps();
    const response = await handle(post(invite, { origin: null }), deps);
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('forbidden_origin');
    expect(touched).toEqual([]);
  });

  it('accepts the preview pattern only as a single DNS label over https', async () => {
    const { deps } = trackedDeps({ APP_PREVIEW_ORIGIN: PREVIEW });
    const allowed = 'https://enjoy-fidelity-card-git-feat-x-bar-team.vercel.app';
    const ok = await handle(preflight(allowed), deps);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(allowed);

    const refused = [
      'http://enjoy-fidelity-card-abc-bar-team.vercel.app',
      'https://enjoy-fidelity-card-a.evil.example-bar-team.vercel.app',
      'https://enjoy-fidelity-card--bar-team.vercel.app',
      'https://enjoy-fidelity-card-abc-bar-team.vercel.app.evil.example',
      'https://enjoy-fidelity-card-abc-bar-teamxvercel.app',
      'https://enjoy-fidelity-card-abc-bar-team.vercel.app:8443',
    ];
    const responses = await Promise.all(refused.map((origin) => handle(preflight(origin), deps)));
    expect(responses.map((response) => response.status)).toEqual(refused.map(() => 403));
  });
});

describe('preflight', () => {
  it('answers OPTIONS itself with the SDK headers, the allowed origin and never *', async () => {
    const { deps, touched } = trackedDeps();
    const response = await handle(
      new Request('http://x/', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:4173', 'Access-Control-Request-Method': 'POST' },
      }),
      deps,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      corsHeaders['Access-Control-Allow-Headers'],
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4173');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(touched).toEqual([]);
  });

  it('never sends Allow-Origin * on any answer', async () => {
    const { deps } = trackedDeps();
    const responses = await Promise.all([
      handle(new Request('http://x/', { method: 'OPTIONS', headers: { Origin: APP } }), deps),
      handle(post(invite, { authorization: null }), deps),
      handle(post('{', {}), deps),
      handle(new Request('http://x/', { method: 'GET', headers: { Origin: APP } }), deps),
    ]);
    for (const response of responses) {
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP);
      expect(response.headers.get('Vary')).toBe('Origin');
    }
  });
});

describe('method', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])(
    'refuses %s with 405 and no client call',
    async (method) => {
      const { deps, touched } = trackedDeps();
      const response = await handle(
        new Request('http://x/', {
          method,
          headers: { Origin: APP, Authorization: TOKEN },
          ...(method === 'GET' ? {} : { body: JSON.stringify(invite) }),
        }),
        deps,
      );
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
      expect(await errorOf(response)).toBe('invalid_input');
      expect(touched).toEqual([]);
    },
  );
});

describe('authorization', () => {
  it.each([
    ['missing', null],
    ['empty', ''],
    ['not a bearer token', 'Basic dXNlcjpwYXNz'],
    ['a bearer without token', 'Bearer '],
  ])(
    'answers 401 unauthorized when the token is %s, with no client call',
    async (_label, authorization) => {
      const { deps, touched } = trackedDeps();
      const response = await handle(post(invite, { authorization }), deps);
      expect(response.status).toBe(401);
      expect(await errorOf(response)).toBe('unauthorized');
      expect(touched).toEqual([]);
    },
  );
});

describe('body', () => {
  const resend = { action: 'resend', operator_id: OPERATION_ID };

  it.each<[string, unknown]>([
    ['invalid JSON', '{"action":'],
    ['an empty body', ''],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['an unknown action', { ...resend, action: 'delete' }],
    ['no action', { operator_id: OPERATION_ID }],
    ['an operation_id that is not a uuid', { ...invite, operation_id: '123' }],
    ['a missing operation_id', { ...invite, operation_id: undefined }],
    ['a name of only spaces', { ...invite, name: '   ' }],
    ['a name over 60 characters', { ...invite, name: 'a'.repeat(61) }],
    ['a name that is not a string', { ...invite, name: 42 }],
    ['an email without @', { ...invite, email: 'giulia.example.test' }],
    ['an email over 254 characters', { ...invite, email: `${'a'.repeat(250)}@x.it` }],
    ['an unknown role', { ...invite, role: 'owner' }],
    ['a redirectTo in the body', { ...invite, redirectTo: 'https://evil.example/' }],
    ['an operator_id on an invite', { ...invite, operator_id: OPERATION_ID }],
    ['a resend without operator_id', { action: 'resend' }],
    ['a cancel with a bad operator_id', { action: 'cancel', operator_id: 'x' }],
    ['a resend with extra fields', { ...resend, email: 'giulia@example.test' }],
  ])('answers 400 invalid_input for %s, with no client call', async (_label, body) => {
    const { deps, touched } = trackedDeps();
    const response = await handle(post(body), deps);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('invalid_input');
    expect(touched).toEqual([]);
  });

  it('refuses a body over 4 KB even when it is valid JSON', async () => {
    const { deps, touched } = trackedDeps();
    const padded = JSON.stringify({ ...invite, name: 'Giulia' }).replace(
      '"name"',
      `${' '.repeat(MAX_BODY_BYTES)}"name"`,
    );
    expect(new TextEncoder().encode(padded).byteLength).toBeGreaterThan(MAX_BODY_BYTES);
    const response = await handle(post(padded), deps);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('invalid_input');
    expect(touched).toEqual([]);
  });

  it('refuses a body over 4 KB announced by Content-Length without reading it', async () => {
    const { deps } = trackedDeps();
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(new TextEncoder().encode('{}'));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request('http://x/', {
      method: 'POST',
      headers: { Origin: APP, Authorization: TOKEN, 'Content-Length': String(MAX_BODY_BYTES + 1) },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const response = await handle(request, deps);
    expect(response.status).toBe(400);
    expect(pulled).toBe(false);
  });

  it('accepts exactly 4 KB of body and every well-formed action', async () => {
    const { deps } = trackedDeps();
    const exact = JSON.stringify(invite);
    const atLimit = exact.replace('"name"', `${' '.repeat(MAX_BODY_BYTES - exact.length)}"name"`);
    expect(new TextEncoder().encode(atLimit).byteLength).toBe(MAX_BODY_BYTES);
    const bodies = [
      atLimit,
      { ...invite, role: 'admin', email: 'Giulia@Example.Test', name: 'Giulia (sala)' },
      { action: 'resend', operator_id: OPERATION_ID.toUpperCase() },
      { action: 'cancel', operator_id: OPERATION_ID },
    ];
    const responses = await Promise.all(bodies.map((body) => handle(post(body), deps)));
    for (const response of responses) expect(response.status).not.toBe(400);
  });
});

describe('responses', () => {
  it('are JSON with the CORS headers of the allowed origin', async () => {
    const { deps } = trackedDeps();
    const response = await handle(post(invite, { authorization: null }), deps);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      corsHeaders['Access-Control-Allow-Headers'],
    );
  });
});

type Call = { client: 'caller' | 'admin'; schema: string; fn: string; args: unknown };
type RpcAnswer = { data: unknown; error: { code: string; message: string } | null };

/** Deps whose clients only answer `schema(...).rpc(...)`, recording every call. */
function rpcDeps(answers: { caller: RpcAnswer; admin?: RpcAnswer }) {
  const calls: Call[] = [];
  const authorizations: string[] = [];
  function rpcClient(client: Call['client'], answer: RpcAnswer): SupabaseClient {
    const target: SupabaseClient = Object.create(null);
    // Only the PostgREST rpc path exists: anything else the handler reaches fails the test.
    return new Proxy(target, {
      get(_target, property) {
        if (property !== 'schema') throw new Error(`${client}.${String(property)} is not faked`);
        return (schema: string) => ({
          rpc: (fn: string, args: unknown) => {
            calls.push({ client, schema, fn, args });
            return Promise.resolve(answer);
          },
        });
      },
    });
  }
  const deps: HandlerDeps = {
    env: { APP_ORIGINS: APP },
    callerClient: (authorization) => {
      authorizations.push(authorization);
      return rpcClient('caller', answers.caller);
    },
    adminClient: rpcClient('admin', answers.admin ?? { data: true, error: null }),
    log: () => undefined,
  };
  return { deps, calls, authorizations };
}

const refused = (code: string): RpcAnswer => ({ data: null, error: { code, message: 'internal' } });

describe('caller check', () => {
  const resend = { action: 'resend', operator_id: OPERATION_ID };
  const cancel = { action: 'cancel', operator_id: OPERATION_ID };

  it('asks the begin RPC of each action with the caller token, never the admin client first', async () => {
    const { deps, calls, authorizations } = rpcDeps({ caller: refused('42501') });
    await handle(post(invite), deps);
    await handle(post(resend), deps);
    await handle(post(cancel), deps);
    expect(authorizations).toEqual([TOKEN, TOKEN, TOKEN]);
    expect(calls).toEqual([
      {
        client: 'caller',
        schema: 'app',
        fn: 'operator_invite_begin',
        args: {
          p_operation_id: OPERATION_ID,
          p_name: 'Giulia',
          p_email: 'giulia@example.test',
          p_role: 'operator',
        },
      },
      {
        client: 'caller',
        schema: 'app',
        fn: 'operator_resend_begin',
        args: { p_operator_id: OPERATION_ID },
      },
      {
        client: 'caller',
        schema: 'app',
        fn: 'operator_cancel_begin',
        args: { p_operator_id: OPERATION_ID },
      },
    ]);
  });

  it.each([invite, resend, cancel])(
    'answers 403 forbidden when the RPC refuses a non-admin (42501), action $action',
    async (body) => {
      const { deps, calls } = rpcDeps({ caller: refused('42501') });
      const response = await handle(post(body), deps);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'forbidden' });
      expect(calls.filter((call) => call.client === 'admin')).toEqual([]);
    },
  );

  it.each(['PGRST301', 'PGRST302', 'PGRST303'])(
    'answers 401 unauthorized when PostgREST refuses the token (%s)',
    async (code) => {
      const { deps, calls } = rpcDeps({ caller: refused(code) });
      const response = await handle(post(invite), deps);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
      expect(calls.filter((call) => call.client === 'admin')).toEqual([]);
    },
  );

  it('answers 502 upstream for any other failure, without internal messages', async () => {
    const { deps } = rpcDeps({ caller: refused('XX000') });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstream' });
  });

  it('answers 502 upstream when the caller client throws', async () => {
    const { deps } = trackedDeps();
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstream' });
  });
});

// The invite steps (SPEC-operators point 5, "Invito"): every client call is scripted and recorded.
const NEW_USER = '0b6d1f3a-2c4e-4a5b-8d7e-9f0a1b2c3d4e';
const OLD_USER = '7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
const OPERATOR = { id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f', name: 'Giulia', role: 'operator' };
/** Text of every internal message: it must never reach a response or a log. */
const SECRET_MESSAGE = 'internal auth detail for giulia@example.test';

type Step =
  | 'caller.operator_invite_begin'
  | 'admin.operator_invite_finish'
  | 'admin.operator_invite_fail'
  | 'admin.operator_invite_orphan'
  | 'admin.updateUserById'
  | 'admin.inviteUserByEmail'
  | 'admin.resetPasswordForEmail'
  | 'admin.deleteUser';
type FakeError = { code?: string; status?: number; message: string };
type Answer = { data: unknown; error: FakeError | null } | 'throw';
type Recorded = { step: Step; args: unknown[] };

const authError = (status: number, code?: string): Answer => ({
  data: null,
  error: { status, message: SECRET_MESSAGE, ...(code === undefined ? {} : { code }) },
});
const ok = (data: unknown): Answer => ({ data, error: null });

const proceed = { status: 'proceed', invited_by_name: 'Anna' };
const finished = { status: 'done', operator: OPERATOR };

/** Default answers: a new user, invited and linked. */
const DEFAULTS: Record<Step, Answer> = {
  'caller.operator_invite_begin': ok(proceed),
  'admin.operator_invite_finish': ok(finished),
  'admin.operator_invite_fail': ok(true),
  'admin.operator_invite_orphan': ok(true),
  'admin.updateUserById': ok({ user: { id: OLD_USER } }),
  'admin.inviteUserByEmail': ok({ user: { id: NEW_USER } }),
  'admin.resetPasswordForEmail': ok({}),
  'admin.deleteUser': ok({ user: null }),
};

function isStep(value: string): value is Step {
  return value in DEFAULTS;
}

function inviteDeps(answers: Partial<Record<Step, Answer>> = {}) {
  const calls: Recorded[] = [];
  const logs: unknown[] = [];
  function call(step: Step, args: unknown[]): Promise<unknown> {
    calls.push({ step, args });
    const answer = answers[step] ?? DEFAULTS[step];
    if (answer === 'throw') return Promise.reject(new Error(SECRET_MESSAGE));
    return Promise.resolve(answer);
  }
  function client(label: 'caller' | 'admin'): SupabaseClient {
    const target: SupabaseClient = Object.create(null);
    const schema = (name: string) => {
      if (name !== 'app') throw new Error(`schema ${name} is not faked`);
      return {
        rpc: (fn: string, args: unknown) => {
          const step = `${label}.${fn}`;
          if (!isStep(step)) throw new Error(`${step} is not expected`);
          return call(step, [args]);
        },
      };
    };
    const auth = {
      admin: {
        updateUserById: (...args: unknown[]) => call('admin.updateUserById', args),
        inviteUserByEmail: (...args: unknown[]) => call('admin.inviteUserByEmail', args),
        deleteUser: (...args: unknown[]) => call('admin.deleteUser', args),
      },
      resetPasswordForEmail: (...args: unknown[]) => call('admin.resetPasswordForEmail', args),
    };
    return new Proxy(target, {
      get(_target, property) {
        if (property === 'schema') return schema;
        if (property === 'auth' && label === 'admin') return auth;
        throw new Error(`${label}.${String(property)} is not faked`);
      },
    });
  }
  const deps: HandlerDeps = {
    env: { APP_ORIGINS: `${APP}, http://localhost:4173`, APP_PREVIEW_ORIGIN: PREVIEW },
    callerClient: () => client('caller'),
    adminClient: client('admin'),
    log: (entry) => logs.push(entry),
  };
  const steps = () => calls.map((recorded) => recorded.step);
  const argsOf = (step: Step) => calls.find((recorded) => recorded.step === step)?.args;
  return { deps, calls, logs, steps, argsOf };
}

const metadata = { name: 'Giulia', invited_by: 'Anna', role_label: 'operatore' };

describe('invite', () => {
  it('a new user: begin, invite, finish, then 200 invited with the profile', async () => {
    const { deps, steps, argsOf, logs } = inviteDeps();
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'invited', operator: OPERATOR });
    expect(steps()).toEqual([
      'caller.operator_invite_begin',
      'admin.inviteUserByEmail',
      'admin.operator_invite_finish',
    ]);
    expect(argsOf('admin.inviteUserByEmail')).toEqual([
      'giulia@example.test',
      { redirectTo: `${APP}/imposta-password`, data: metadata },
    ]);
    expect(argsOf('admin.operator_invite_finish')).toEqual([
      { p_operation_id: OPERATION_ID, p_user_id: NEW_USER },
    ]);
    expect(logs).toEqual([{ operation_id: OPERATION_ID, action: 'invite', outcome: 'invited' }]);
  });

  it('an admin: role_label amministratore in the metadata', async () => {
    const { deps, argsOf } = inviteDeps();
    const response = await handle(post({ ...invite, role: 'admin' }), deps);
    expect(response.status).toBe(200);
    expect(argsOf('admin.inviteUserByEmail')?.[1]).toEqual({
      redirectTo: `${APP}/imposta-password`,
      data: { ...metadata, role_label: 'amministratore' },
    });
  });

  it('an existing unconfirmed user: metadata first, then the invite, then finish on that user', async () => {
    const { deps, steps, argsOf } = inviteDeps({
      'caller.operator_invite_begin': ok({
        ...proceed,
        existing_user_id: OLD_USER,
        existing_confirmed: false,
        existing_has_password: false,
      }),
      'admin.inviteUserByEmail': ok({ user: { id: OLD_USER } }),
    });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(200);
    expect(steps()).toEqual([
      'caller.operator_invite_begin',
      'admin.updateUserById',
      'admin.inviteUserByEmail',
      'admin.operator_invite_finish',
    ]);
    expect(argsOf('admin.updateUserById')).toEqual([OLD_USER, { user_metadata: metadata }]);
    expect(argsOf('admin.operator_invite_finish')).toEqual([
      { p_operation_id: OPERATION_ID, p_user_id: OLD_USER },
    ]);
  });

  it('an existing user with a password: a random 32-byte password replaces it, never shown', async () => {
    const begin = ok({
      ...proceed,
      existing_user_id: OLD_USER,
      existing_confirmed: false,
      existing_has_password: true,
    });
    const first = inviteDeps({ 'caller.operator_invite_begin': begin });
    const second = inviteDeps({ 'caller.operator_invite_begin': begin });
    const responses = [
      await handle(post(invite), first.deps),
      await handle(post(invite), second.deps),
    ];
    const passwords = [first, second].map((run) => {
      const update = run.argsOf('admin.updateUserById');
      expect(update?.[0]).toBe(OLD_USER);
      const attributes: unknown = update?.[1];
      expect(attributes).toEqual({ user_metadata: metadata, password: expect.any(String) });
      return typeof attributes === 'object' && attributes !== null && 'password' in attributes
        ? String(attributes.password)
        : '';
    });
    // 32 bytes in base64url: 43 characters, never the same twice.
    for (const password of passwords) expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(passwords[0]).not.toBe(passwords[1]);
    const bodies = await Promise.all(responses.map((response) => response.text()));
    const logged = JSON.stringify([first.logs, second.logs]);
    for (const password of passwords) {
      for (const text of [...bodies, logged]) expect(text).not.toContain(password);
    }
  });

  it('an existing confirmed user: a recovery link with the same redirectTo, no invite', async () => {
    const { deps, steps, argsOf } = inviteDeps({
      'caller.operator_invite_begin': ok({
        ...proceed,
        existing_user_id: OLD_USER,
        existing_confirmed: true,
        existing_has_password: true,
      }),
    });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(200);
    expect(steps()).toEqual([
      'caller.operator_invite_begin',
      'admin.updateUserById',
      'admin.resetPasswordForEmail',
      'admin.operator_invite_finish',
    ]);
    expect(argsOf('admin.resetPasswordForEmail')).toEqual([
      'giulia@example.test',
      { redirectTo: `${APP}/imposta-password` },
    ]);
    expect(argsOf('admin.operator_invite_finish')).toEqual([
      { p_operation_id: OPERATION_ID, p_user_id: OLD_USER },
    ]);
  });

  it('done: the same profile again, no email and no other step', async () => {
    const { deps, steps, logs } = inviteDeps({
      'caller.operator_invite_begin': ok({ status: 'done', operator: OPERATOR }),
    });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'invited', operator: OPERATOR });
    expect(steps()).toEqual(['caller.operator_invite_begin']);
    expect(logs).toEqual([{ operation_id: OPERATION_ID, action: 'invite', outcome: 'invited' }]);
  });

  it.each<[string, unknown, number, unknown]>([
    ['in_progress', { status: 'in_progress' }, 409, { error: 'in_progress' }],
    ['name_taken', { status: 'name_taken' }, 409, { error: 'name_taken' }],
    [
      'email_taken',
      { status: 'email_taken', deactivated: false },
      409,
      { error: 'email_taken', deactivated: false },
    ],
    [
      'email_taken of a deactivated person',
      { status: 'email_taken', deactivated: true },
      409,
      { error: 'email_taken', deactivated: true },
    ],
    ['email_is_device', { status: 'email_is_device' }, 409, { error: 'email_is_device' }],
  ])('begin answers %s: %i, no Auth call', async (_label, data, status, body) => {
    const { deps, steps } = inviteDeps({ 'caller.operator_invite_begin': ok(data) });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(steps()).toEqual(['caller.operator_invite_begin']);
  });

  it.each<[string, string, number, string]>([
    ['EO005, an admin invited from a device', 'EO005', 403, 'admin_from_device'],
    [
      '22023, invalid input or the same operation_id with other data',
      '22023',
      400,
      'invalid_input',
    ],
  ])('begin raises %s', async (_label, code, status, error) => {
    const { deps, steps } = inviteDeps({
      'caller.operator_invite_begin': { data: null, error: { code, message: SECRET_MESSAGE } },
    });
    const response = await handle(post({ ...invite, role: 'admin' }), deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(steps()).toEqual(['caller.operator_invite_begin']);
  });

  it('begin with an answer it does not know: 502 and nothing else (it may not hold the reservation)', async () => {
    const { deps, steps } = inviteDeps({ 'caller.operator_invite_begin': ok({ status: 'maybe' }) });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstream' });
    expect(steps()).toEqual(['caller.operator_invite_begin']);
  });

  it.each<[string, Step]>([
    ['the invite', 'admin.inviteUserByEmail'],
    ['the recovery link', 'admin.resetPasswordForEmail'],
  ])('429 on %s: 429 rate_limited and the reservation released', async (_label, step) => {
    const { deps, steps, argsOf } = inviteDeps({
      'caller.operator_invite_begin': ok(
        step === 'admin.resetPasswordForEmail'
          ? { ...proceed, existing_user_id: OLD_USER, existing_confirmed: true }
          : proceed,
      ),
      [step]: authError(429, 'over_email_send_rate_limit'),
    });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'rate_limited' });
    expect(steps().slice(-2)).toEqual([step, 'admin.operator_invite_fail']);
    expect(steps()).not.toContain('admin.operator_invite_finish');
    expect(steps()).not.toContain('admin.deleteUser');
    expect(argsOf('admin.operator_invite_fail')).toEqual([{ p_operation_id: OPERATION_ID }]);
  });

  it('422 email_exists on the invite: 409 email_taken and the reservation released', async () => {
    const { deps, steps } = inviteDeps({
      'admin.inviteUserByEmail': authError(422, 'email_exists'),
    });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'email_taken' });
    expect(steps()).toEqual([
      'caller.operator_invite_begin',
      'admin.inviteUserByEmail',
      'admin.operator_invite_fail',
    ]);
  });

  it.each<[string, Answer]>([
    ['another Auth error', authError(500, 'unexpected_failure')],
    ['an invalid email for Auth', authError(400, 'validation_failed')],
    ['a client that throws', 'throw'],
    ['an answer without user', ok({ user: null })],
  ])(
    'the invite fails with %s: 502 upstream and the reservation released',
    async (_label, answer) => {
      const { deps, steps } = inviteDeps({ 'admin.inviteUserByEmail': answer });
      const response = await handle(post(invite), deps);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'upstream' });
      expect(steps()).toEqual([
        'caller.operator_invite_begin',
        'admin.inviteUserByEmail',
        'admin.operator_invite_fail',
      ]);
    },
  );

  it('the metadata update fails: no email, 502 and the reservation released', async () => {
    const { deps, steps } = inviteDeps({
      'caller.operator_invite_begin': ok({ ...proceed, existing_user_id: OLD_USER }),
      'admin.updateUserById': authError(500),
    });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(502);
    expect(steps()).toEqual([
      'caller.operator_invite_begin',
      'admin.updateUserById',
      'admin.operator_invite_fail',
    ]);
  });

  it('finish name_taken on a new user that is an orphan: deleteUser, then the reservation released', async () => {
    const { deps, steps, argsOf } = inviteDeps({
      'admin.operator_invite_finish': ok({ status: 'name_taken' }),
    });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'name_taken' });
    expect(steps()).toEqual([
      'caller.operator_invite_begin',
      'admin.inviteUserByEmail',
      'admin.operator_invite_finish',
      'admin.operator_invite_orphan',
      'admin.deleteUser',
      'admin.operator_invite_fail',
    ]);
    expect(argsOf('admin.operator_invite_orphan')).toEqual([
      { p_operation_id: OPERATION_ID, p_user_id: NEW_USER },
    ]);
    expect(argsOf('admin.deleteUser')).toEqual([NEW_USER]);
  });

  it.each<[string, Answer]>([
    ['false', ok(false)],
    ['an error', authError(500)],
    ['a throw', 'throw'],
  ])(
    'finish name_taken on a new user, orphan answers %s: no deleteUser',
    async (_label, answer) => {
      const { deps, steps } = inviteDeps({
        'admin.operator_invite_finish': ok({ status: 'name_taken' }),
        'admin.operator_invite_orphan': answer,
      });
      const response = await handle(post(invite), deps);
      expect(response.status).toBe(409);
      expect(steps()).not.toContain('admin.deleteUser');
      expect(steps().at(-1)).toBe('admin.operator_invite_fail');
    },
  );

  it('finish name_taken on a user that already existed: never asks to delete it', async () => {
    const { deps, steps } = inviteDeps({
      'caller.operator_invite_begin': ok({ ...proceed, existing_user_id: OLD_USER }),
      'admin.operator_invite_finish': ok({ status: 'name_taken' }),
    });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(409);
    expect(steps()).not.toContain('admin.operator_invite_orphan');
    expect(steps()).not.toContain('admin.deleteUser');
    expect(steps().at(-1)).toBe('admin.operator_invite_fail');
  });

  it('a failed deleteUser still releases the reservation', async () => {
    const { deps, steps } = inviteDeps({
      'admin.operator_invite_finish': ok({ status: 'name_taken' }),
      'admin.deleteUser': authError(500),
    });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(409);
    expect(steps().slice(-2)).toEqual(['admin.deleteUser', 'admin.operator_invite_fail']);
  });

  it.each<[string, Answer, number, unknown]>([
    [
      'email_taken',
      ok({ status: 'email_taken', deactivated: true }),
      409,
      { error: 'email_taken', deactivated: true },
    ],
    ['email_is_device', ok({ status: 'email_is_device' }), 409, { error: 'email_is_device' }],
    ['forbidden (no longer an admin)', ok({ status: 'forbidden' }), 403, { error: 'forbidden' }],
    [
      'an error',
      { data: null, error: { code: '55000', message: SECRET_MESSAGE } },
      502,
      { error: 'upstream' },
    ],
    ['a throw', 'throw', 502, { error: 'upstream' }],
    ['an answer it does not know', ok({ status: 'maybe' }), 502, { error: 'upstream' }],
  ])('finish answers %s: compensation and %i', async (_label, answer, status, body) => {
    const { deps, steps } = inviteDeps({ 'admin.operator_invite_finish': answer });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(steps().slice(-3)).toEqual([
      'admin.operator_invite_orphan',
      'admin.deleteUser',
      'admin.operator_invite_fail',
    ]);
  });

  it('redirectTo is always the allowed Origin of the request, never anything else', async () => {
    const preview = 'https://enjoy-fidelity-card-git-feat-x-bar-team.vercel.app';
    const runs = ['http://localhost:4173', preview].map((origin) => ({ origin, ...inviteDeps() }));
    const responses = await Promise.all(
      runs.map(({ origin, deps }) => handle(post(invite, { origin }), deps)),
    );
    runs.forEach(({ origin, argsOf }, index) => {
      expect(responses[index]?.status).toBe(200);
      expect(responses[index]?.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(argsOf('admin.inviteUserByEmail')?.[1]).toEqual({
        redirectTo: `${origin}/imposta-password`,
        data: metadata,
      });
    });
  });

  it('never puts an email, the token or an Auth message in a response or a log', async () => {
    const scenarios: Partial<Record<Step, Answer>>[] = [
      {},
      { 'caller.operator_invite_begin': ok({ status: 'in_progress' }) },
      {
        'caller.operator_invite_begin': {
          data: null,
          error: { code: 'EO005', message: SECRET_MESSAGE },
        },
      },
      { 'admin.inviteUserByEmail': authError(429, 'over_email_send_rate_limit') },
      { 'admin.inviteUserByEmail': authError(422, 'email_exists') },
      { 'admin.inviteUserByEmail': authError(500) },
      { 'admin.inviteUserByEmail': 'throw' },
      {
        'caller.operator_invite_begin': ok({
          ...proceed,
          existing_user_id: OLD_USER,
          existing_confirmed: true,
        }),
        'admin.resetPasswordForEmail': authError(429, 'over_email_send_rate_limit'),
      },
      { 'admin.operator_invite_finish': ok({ status: 'name_taken' }) },
      { 'admin.operator_invite_finish': 'throw', 'admin.deleteUser': 'throw' },
    ];
    const runs = scenarios.map((answers) => inviteDeps(answers));
    const responses = await Promise.all(runs.map((run) => handle(post(invite), run.deps)));
    const bodies = await Promise.all(responses.map((response) => response.text()));
    runs.forEach(({ logs }, index) => {
      const texts = [
        bodies[index] ?? '',
        JSON.stringify([...(responses[index]?.headers ?? [])]),
        JSON.stringify(logs),
      ];
      for (const text of texts) {
        expect(text).not.toContain('giulia@example.test');
        expect(text).not.toContain('example.test');
        expect(text).not.toContain('header.payload.signature');
        expect(text).not.toContain(SECRET_MESSAGE);
        expect(text).not.toContain('internal');
      }
      expect(logs).toHaveLength(1);
      for (const entry of logs) {
        expect(Object.keys(entry ?? {}).toSorted()).toEqual(['action', 'operation_id', 'outcome']);
      }
    });
  });
});
