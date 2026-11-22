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

  it('until the invite steps exist, releases a reservation it made (operator_invite_fail)', async () => {
    const { deps, calls } = rpcDeps({
      caller: { data: { status: 'proceed', invited_by_name: 'Anna' }, error: null },
    });
    const response = await handle(post(invite), deps);
    expect(response.status).toBe(502);
    expect(calls.map((call) => `${call.client}.${call.fn}`)).toEqual([
      'caller.operator_invite_begin',
      'admin.operator_invite_fail',
    ]);
    expect(calls[1]?.args).toEqual({ p_operation_id: OPERATION_ID });
  });
});
