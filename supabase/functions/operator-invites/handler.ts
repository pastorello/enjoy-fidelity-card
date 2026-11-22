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

/** The code of a refused begin: the caller's rights never come from anything but the RPC. */
function refusalCode(error: NonNullable<RpcError>): ErrorCode {
  if (error.code === '42501') return 'forbidden';
  if (error.code === 'EO005') return 'admin_from_device';
  if (error.code === '22023') return 'invalid_input';
  if (error.code === 'EO002') return 'self';
  // EO004 not invited any more; P0002 no such profile (not in the table of the spec: the person
  // is not waiting for an invite either, and the dialog asks to reload the list).
  if (error.code === 'EO004' || error.code === 'P0002') return 'not_invited';
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
  if (input.action === 'resend') return resend(input, context);
  return cancel(input, context);
}

function recordOf(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? { ...data } : {};
}

function uuidOf(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/**
 * The begin RPC of resend and cancel with the caller's token: PostgREST checks the token, the RPC
 * is_admin(), the target and the caller (EO002, EO004). Its data, or the outcome of a refusal.
 */
async function operatorBegin(
  input: OperatorInput,
  { authorization, deps }: Context,
): Promise<{ data: Record<string, unknown> } | { outcome: Outcome }> {
  const fn = input.action === 'resend' ? 'operator_resend_begin' : 'operator_cancel_begin';
  try {
    const { data, error } = await deps
      .callerClient(authorization)
      .schema('app')
      .rpc(fn, { p_operator_id: input.operator_id });
    if (error) return { outcome: failure(refusalCode(error)) };
    return { data: recordOf(data) };
  } catch {
    // A client that throws is a server failure; nothing of it reaches the answer.
    return { outcome: failure('upstream') };
  }
}

/**
 * The resend (SPEC-operators point 5, "Reinvio"): begin, metadata naming who sends it again, the
 * invite (or a recovery link once the email is confirmed), then finish with the requested_by of
 * begin. No idempotency: every resend sends an email and the last one wins.
 */
async function resend(input: OperatorInput, context: Context): Promise<Outcome> {
  const begin = await operatorBegin(input, context);
  if ('outcome' in begin) return begin.outcome;
  const target = begin.data;
  const userId = uuidOf(target.user_id);
  const requestedBy = uuidOf(target.requested_by);
  const { email, name, role_label: roleLabel, invited_by_name: invitedBy } = target;
  if (userId === null || requestedBy === null) return failure('upstream');
  if (typeof email !== 'string' || email === '' || typeof name !== 'string') {
    return failure('upstream');
  }
  if (roleLabel !== ROLE_LABEL.admin && roleLabel !== ROLE_LABEL.operator) {
    return failure('upstream');
  }

  const redirectTo = `${context.origin}/imposta-password`;
  const metadata = {
    name,
    invited_by: typeof invitedBy === 'string' ? invitedBy : '',
    role_label: roleLabel,
  };
  const { deps } = context;
  const admin = deps.adminClient.auth;
  try {
    const updated = await admin.admin.updateUserById(userId, { user_metadata: metadata });
    if (updated.error) return resendAuthFailure(updated.error);
    const { error } =
      target.email_confirmed === true
        ? await admin.resetPasswordForEmail(email, { redirectTo })
        : await admin.admin.inviteUserByEmail(email, { redirectTo, data: metadata });
    if (error) return resendAuthFailure(error);
  } catch {
    return failure('upstream');
  }

  try {
    const { data, error } = await deps.adminClient.schema('app').rpc('operator_resend_finish', {
      p_operator_id: input.operator_id,
      p_requested_by: requestedBy,
    });
    if (error) return failure(error.code === 'P0002' ? 'not_invited' : 'upstream');
    const answer = recordOf(data);
    if (answer.status === 'done')
      return { status: 200, body: { status: 'resent' }, logged: 'resent' };
    if (answer.status === 'forbidden') return failure('forbidden');
  } catch {
    // Falls through: the email left, but the database did not say done.
  }
  return failure('upstream');
}

/** 422 email_exists on a resend: the link was opened meanwhile, the list is out of date. */
function resendAuthFailure(error: {
  status?: number | undefined;
  code?: string | undefined;
}): Outcome {
  const outcome = authFailure(error);
  return outcome.logged === 'email_taken' ? failure('not_invited') : outcome;
}

/**
 * The cancel (SPEC-operators point 5, "Annullamento"): begin, then operator_cancel_check rereads
 * the database with the secret key, and only its `true` deletes the Auth user (the profile
 * becomes removed through `on delete set null`; no row of app.operators is deleted).
 */
async function cancel(input: OperatorInput, context: Context): Promise<Outcome> {
  const begin = await operatorBegin(input, context);
  if ('outcome' in begin) return begin.outcome;
  const userId = uuidOf(begin.data.user_id);
  const requestedBy = uuidOf(begin.data.requested_by);
  if (userId === null || requestedBy === null) return failure('upstream');

  const { deps } = context;
  try {
    const { data, error } = await deps.adminClient.schema('app').rpc('operator_cancel_check', {
      p_operator_id: input.operator_id,
      p_user_id: userId,
      p_requested_by: requestedBy,
    });
    if (error) return failure('upstream');
    if (data !== true) return failure('not_invited');
    const deleted = await deps.adminClient.auth.admin.deleteUser(userId);
    if (deleted.error) return failure('upstream');
  } catch {
    return failure('upstream');
  }
  return { status: 200, body: { status: 'cancelled' }, logged: 'cancelled' };
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
