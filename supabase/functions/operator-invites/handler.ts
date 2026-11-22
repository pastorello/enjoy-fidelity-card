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

/** The begin RPC of resend and cancel, called with the caller's token: PostgREST checks the token, the RPC is_admin(). */
function beginCall(input: OperatorInput): { fn: string; args: Record<string, string> } {
  const fn = input.action === 'resend' ? 'operator_resend_begin' : 'operator_cancel_begin';
  return { fn, args: { p_operator_id: input.operator_id } };
}

/** The code of a refused begin: the caller's rights never come from anything but the RPC. */
function refusalCode(error: NonNullable<RpcError>): ErrorCode {
  if (error.code === '42501') return 'forbidden';
  if (error.code === 'EO005') return 'admin_from_device';
  if (error.code === '22023') return 'invalid_input';
  // PGRST301-303: token missing, invalid or expired (PostgREST).
  if (error.code !== undefined && /^PGRST30\d$/.test(error.code)) return 'unauthorized';
  return 'upstream';
}

/** HTTP status of each error code (SPEC-operators point 5, "Risposte HTTP"). */
const STATUS: Record<ErrorCode, number> = {
  forbidden_origin: 403,
  invalid_input: 400,
  unauthorized: 401,
  forbidden: 403,
  self: 403,
  admin_from_device: 403,
  in_progress: 409,
  name_taken: 409,
  email_taken: 409,
  email_is_device: 409,
  not_invited: 409,
  rate_limited: 429,
  upstream: 502,
};

/** An outcome of an action: the answer and the word written in the log. */
type Outcome = { status: number; body: Record<string, unknown>; logged: string };

function failure(code: ErrorCode, extra: Record<string, unknown> = {}): Outcome {
  return { status: STATUS[code], body: { error: code, ...extra }, logged: code };
}

async function perform(input: Input, context: Context): Promise<Response> {
  const outcome = await settle(input, context);
  context.deps.log({
    ...(input.action === 'invite' ? { operation_id: input.operation_id } : {}),
    action: input.action,
    outcome: outcome.logged,
  });
  return json(outcome.status, outcome.body, context.origin);
}

async function settle(input: Input, context: Context): Promise<Outcome> {
  if (input.action === 'invite') return invite(input, context);
  // The resend and cancel steps after the begin RPC arrive with task 9 of
  // tasks/operators/todo.md; until then an allowed request answers like a failure of the server.
  const { fn, args } = beginCall(input);
  try {
    const { error } = await context.deps
      .callerClient(context.authorization)
      .schema('app')
      .rpc(fn, args);
    if (error) return failure(refusalCode(error));
  } catch {
    // A client that throws is a server failure; nothing of it reaches the answer.
  }
  return failure('upstream');
}

/** What operator_invite_begin answered, read without trusting its shape. */
type Begin =
  | { status: 'proceed'; invitedBy: string; existing: Existing | null }
  | { status: 'done'; operator: unknown }
  | { status: 'refused'; outcome: Outcome }
  | { status: 'unknown' };
type Existing = { userId: string; confirmed: boolean; hasPassword: boolean };

/** Conflicts that begin and finish both answer as data, never as exceptions. */
function conflict(data: Record<string, unknown>): Outcome | null {
  switch (data.status) {
    case 'in_progress':
    case 'name_taken':
    case 'email_is_device':
      return failure(data.status);
    case 'email_taken':
      return failure('email_taken', { deactivated: data.deactivated === true });
    case 'forbidden':
      return failure('forbidden');
    default:
      return null;
  }
}

function readBegin(data: unknown): Begin {
  if (typeof data !== 'object' || data === null) return { status: 'unknown' };
  const fields: Record<string, unknown> = { ...data };
  if (fields.status === 'done') return { status: 'done', operator: fields.operator };
  if (fields.status === 'proceed') {
    const invitedBy = typeof fields.invited_by_name === 'string' ? fields.invited_by_name : '';
    const userId = fields.existing_user_id;
    const existing =
      typeof userId === 'string' && UUID.test(userId)
        ? {
            userId,
            confirmed: fields.existing_confirmed === true,
            hasPassword: fields.existing_has_password === true,
          }
        : null;
    return { status: 'proceed', invitedBy, existing };
  }
  const refused = fields.status === 'forbidden' ? null : conflict(fields);
  return refused === null ? { status: 'unknown' } : { status: 'refused', outcome: refused };
}

const ROLE_LABEL = { admin: 'amministratore', operator: 'operatore' } as const;

/** An Auth error as a code of the function: the rate limit and a confirmed email, else upstream. */
function authFailure(error: { status?: number | undefined; code?: string | undefined }): Outcome {
  if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
    return failure('rate_limited');
  }
  if (error.status === 422 && error.code === 'email_exists') return failure('email_taken');
  return failure('upstream');
}

/** 32 random bytes in base64url: replaces a password chosen before, never stored or logged. */
function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/**
 * The invite (SPEC-operators point 5, "Invito"): begin with the caller's token, then the Auth
 * steps and finish with the secret key, and the compensation when one of them fails.
 */
async function invite(
  input: InviteInput,
  { origin, authorization, deps }: Context,
): Promise<Outcome> {
  let begin: Begin;
  try {
    const { data, error } = await deps
      .callerClient(authorization)
      .schema('app')
      .rpc('operator_invite_begin', {
        p_operation_id: input.operation_id,
        p_name: input.name,
        p_email: input.email,
        p_role: input.role,
      });
    if (error) return failure(refusalCode(error));
    begin = readBegin(data);
  } catch {
    return failure('upstream');
  }
  if (begin.status === 'done') return invited(begin.operator);
  if (begin.status === 'refused') return begin.outcome;
  // Begin failed or answered something unknown: whether this request holds the reservation is
  // not known, so it is not released (a double tap may hold it); it frees itself after 2 minutes.
  if (begin.status === 'unknown') return failure('upstream');

  const redirectTo = `${origin}/imposta-password`;
  const metadata = {
    name: input.name,
    invited_by: begin.invitedBy,
    role_label: ROLE_LABEL[input.role],
  };
  const { existing } = begin;
  const admin = deps.adminClient.auth;

  let userId: string;
  try {
    if (existing !== null) {
      const { error } = await admin.admin.updateUserById(existing.userId, {
        user_metadata: metadata,
        ...(existing.hasPassword ? { password: randomPassword() } : {}),
      });
      if (error) return await released(input, deps, authFailure(error));
    }
    if (existing?.confirmed) {
      const { error } = await admin.resetPasswordForEmail(input.email, { redirectTo });
      if (error) return await released(input, deps, authFailure(error));
      userId = existing.userId;
    } else {
      const { data, error } = await admin.admin.inviteUserByEmail(input.email, {
        redirectTo,
        data: metadata,
      });
      if (error) return await released(input, deps, authFailure(error));
      const invitedId = existing?.userId ?? data.user?.id;
      if (typeof invitedId !== 'string') return await released(input, deps, failure('upstream'));
      userId = invitedId;
    }
  } catch {
    return released(input, deps, failure('upstream'));
  }

  let outcome: Outcome;
  try {
    const { data, error } = await deps.adminClient
      .schema('app')
      .rpc('operator_invite_finish', { p_operation_id: input.operation_id, p_user_id: userId });
    const answer: Record<string, unknown> =
      !error && typeof data === 'object' && data !== null ? { ...data } : {};
    if (answer.status === 'done') return invited(answer.operator);
    outcome = conflict(answer) ?? failure('upstream');
  } catch {
    outcome = failure('upstream');
  }

  // Delete only a user this operation created, and only when the database says it may.
  if (existing === null) await deleteOrphan(input, userId, deps);
  return released(input, deps, outcome);
}

function invited(operator: unknown): Outcome {
  return { status: 200, body: { status: 'invited', operator }, logged: 'invited' };
}

async function deleteOrphan(input: InviteInput, userId: string, deps: HandlerDeps): Promise<void> {
  try {
    const { data, error } = await deps.adminClient
      .schema('app')
      .rpc('operator_invite_orphan', { p_operation_id: input.operation_id, p_user_id: userId });
    if (error || data !== true) return;
    await deps.adminClient.auth.admin.deleteUser(userId);
  } catch {
    // The compensation failed: an Auth user without profile stays, reused by the next invite.
  }
}

/** operator_invite_fail: pending -> failed, so a new tap starts at once. Never throws. */
async function release(input: InviteInput, deps: HandlerDeps): Promise<void> {
  try {
    await deps.adminClient
      .schema('app')
      .rpc('operator_invite_fail', { p_operation_id: input.operation_id });
  } catch {
    // The reservation frees itself after 2 minutes (operator_invite_begin).
  }
}

async function released(input: InviteInput, deps: HandlerDeps, outcome: Outcome): Promise<Outcome> {
  await release(input, deps);
  return outcome;
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
