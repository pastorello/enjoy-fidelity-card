// Edge Function `operator-invites` (SPEC-operators point 5): all the logic, with the clients and the
// environment injected. No Deno globals here (only index.ts uses them), so Vitest runs it in Node.
import type { SupabaseClient } from '@supabase/supabase-js';
import { corsHeaders } from '@supabase/supabase-js/cors';

/** Largest accepted request body, in bytes (SPEC-operators point 5). */
export const MAX_BODY_BYTES = 4096;

export type HandlerEnv = {
  /** Comma-separated exact origins of the app. */
  APP_ORIGINS: string;
  /** Staging only: preview origin pattern, `*` standing for one DNS label part. */
  APP_PREVIEW_ORIGIN?: string | undefined;
};

export type LogEntry = { operation_id?: string; action: string; outcome: string };

export type HandlerDeps = {
  env: HandlerEnv;
  /** Client with the publishable key and the caller's Authorization (PostgREST checks the token). */
  callerClient: (authorization: string) => SupabaseClient;
  /** Client with the secret key: only the service_role steps, never the caller's checks. */
  adminClient: SupabaseClient;
  /** Only operation_id, action and outcome: never emails or Auth messages. */
  log: (entry: LogEntry) => void;
};

export type InviteInput = {
  action: 'invite';
  operation_id: string;
  name: string;
  email: string;
  role: 'admin' | 'operator';
};
export type OperatorInput = { action: 'resend' | 'cancel'; operator_id: string };
export type Input = InviteInput | OperatorInput;

export type ErrorCode =
  | 'forbidden_origin'
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'self'
  | 'admin_from_device'
  | 'in_progress'
  | 'name_taken'
  | 'email_taken'
  | 'email_is_device'
  | 'not_invited'
  | 'rate_limited'
  | 'upstream';

const ALLOW_METHODS = 'POST, OPTIONS';
const ALLOW_HEADERS = corsHeaders['Access-Control-Allow-Headers'] ?? '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same shape and limits as app.operator_invite_begin, which stays the authority.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_NAME = 60;
const MAX_EMAIL = 254;

export async function handle(request: Request, deps: HandlerDeps): Promise<Response> {
  const origin = allowedOrigin(request.headers.get('Origin'), deps.env);
  if (origin === null) return json(403, { error: 'forbidden_origin' }, null);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (request.method !== 'POST') {
    const response = json(405, { error: 'invalid_input' }, origin);
    response.headers.set('Allow', ALLOW_METHODS);
    return response;
  }

  const authorization = bearer(request.headers.get('Authorization'));
  if (authorization === null) return json(401, { error: 'unauthorized' }, origin);

  const text = await readLimited(request);
  const input = text === null ? null : parseInput(text);
  if (input === null) return json(400, { error: 'invalid_input' }, origin);

  return perform(input, { origin, authorization, deps });
}

type Context = { origin: string; authorization: string; deps: HandlerDeps };

type RpcError = { code?: string } | null;

/** The begin RPC of each action, called with the caller's token: PostgREST checks the token, the RPC is_admin(). */
function beginCall(input: Input): { fn: string; args: Record<string, string> } {
  if (input.action === 'invite') {
    return {
      fn: 'operator_invite_begin',
      args: {
        p_operation_id: input.operation_id,
        p_name: input.name,
        p_email: input.email,
        p_role: input.role,
      },
    };
  }
  const fn = input.action === 'resend' ? 'operator_resend_begin' : 'operator_cancel_begin';
  return { fn, args: { p_operator_id: input.operator_id } };
}

/** The answer to a refused begin: the caller's rights never come from anything but the RPC. */
function refusal(error: NonNullable<RpcError>, origin: string): Response {
  if (error.code === '42501') return json(403, { error: 'forbidden' }, origin);
  // PGRST301-303: token missing, invalid or expired (PostgREST).
  if (error.code !== undefined && /^PGRST30\d$/.test(error.code)) {
    return json(401, { error: 'unauthorized' }, origin);
  }
  return json(502, { error: 'upstream' }, origin);
}

// The invite, resend and cancel steps after the begin RPC arrive with tasks 8 and 9 of
// tasks/operators/todo.md; until then an allowed request answers like any other failure of the
// server, and an invite reservation it made is released so a new tap starts at once.
async function perform(input: Input, { origin, authorization, deps }: Context): Promise<Response> {
  const { fn, args } = beginCall(input);
  try {
    const { error } = await deps.callerClient(authorization).schema('app').rpc(fn, args);
    if (error) return refusal(error, origin);
    if (input.action === 'invite') {
      await deps.adminClient
        .schema('app')
        .rpc('operator_invite_fail', { p_operation_id: input.operation_id });
    }
  } catch {
    // A client that throws is a server failure; nothing of it reaches the answer.
  }
  return json(502, { error: 'upstream' }, origin);
}

/** The request origin when it is allowed, else null. Exact match, or the preview pattern. */
export function allowedOrigin(origin: string | null, env: HandlerEnv): string | null {
  if (origin === null || origin === '' || origin === 'null') return null;
  const exact = env.APP_ORIGINS.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (exact.includes(origin)) return origin;
  const pattern = env.APP_PREVIEW_ORIGIN?.trim();
  if (pattern && previewMatcher(pattern)?.test(origin)) return origin;
  return null;
}

/** `https://name-*-team.vercel.app` → each `*` is [a-z0-9] runs joined by single hyphens, never a dot. */
function previewMatcher(pattern: string): RegExp | null {
  if (!pattern.startsWith('https://') || !pattern.includes('*')) return null;
  const source = pattern
    .split('*')
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
    .join('[a-z0-9]+(?:-[a-z0-9]+)*');
  return new RegExp(`^${source}$`);
}

function bearer(header: string | null): string | null {
  const match = header === null ? null : /^Bearer\s+(\S+)$/.exec(header);
  return match ? header : null;
}

/** The body as text, or null when it is over MAX_BODY_BYTES (read at most that much). */
async function readLimited(request: Request): Promise<string | null> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && !(Number(declared) <= MAX_BODY_BYTES)) return null;
  if (request.body === null) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  // Leaving the loop early cancels the stream: nothing past the limit is read.
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function parseInput(text: string): Input | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const fields: Record<string, unknown> = { ...body };
  const keys = Object.keys(fields).toSorted().join(',');

  if (fields.action === 'invite') {
    if (keys !== 'action,email,name,operation_id,role') return null;
    const { operation_id: operationId, name, email, role } = fields;
    if (typeof operationId !== 'string' || !UUID.test(operationId)) return null;
    if (typeof name !== 'string' || typeof email !== 'string') return null;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedName.length < 1 || trimmedName.length > MAX_NAME) return null;
    if (trimmedEmail.length > MAX_EMAIL || !EMAIL.test(trimmedEmail)) return null;
    if (role !== 'admin' && role !== 'operator') return null;
    return {
      action: 'invite',
      operation_id: operationId,
      name: trimmedName,
      email: trimmedEmail,
      role,
    };
  }
  if (fields.action === 'resend' || fields.action === 'cancel') {
    if (keys !== 'action,operator_id') return null;
    const { operator_id: operatorId } = fields;
    if (typeof operatorId !== 'string' || !UUID.test(operatorId)) return null;
    return { action: fields.action, operator_id: operatorId };
  }
  return null;
}

function cors(origin: string): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    Vary: 'Origin',
  });
}

/** JSON answer; CORS headers only for an allowed origin, `Vary: Origin` always. */
export function json(
  status: number,
  body: { error: ErrorCode } | Record<string, unknown>,
  origin: string | null,
): Response {
  const headers = origin === null ? new Headers({ Vary: 'Origin' }) : cors(origin);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}
