/**
 * Reads the emails caught by Mailpit, the local SMTP server of the Supabase stack
 * (`[local_smtp]` in supabase/config.toml). Local stack only: it never reaches a real inbox.
 */
export const MAILPIT_URL = 'http://127.0.0.1:54324';

export type MailpitMessage = { id: string; subject: string; created: Date; html: string };

type Summary = { id: string; created: string; subject: string; to: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path}: HTTP ${response.status}`);
  const body: unknown = await response.json();
  return body;
}

/** One entry of `/api/v1/search`, or an error if Mailpit changed its format. */
function toSummary(value: unknown): Summary {
  if (
    isRecord(value) &&
    typeof value['ID'] === 'string' &&
    typeof value['Created'] === 'string' &&
    typeof value['Subject'] === 'string'
  ) {
    const to = Array.isArray(value['To']) ? value['To'] : [];
    return {
      id: value['ID'],
      created: value['Created'],
      subject: value['Subject'],
      to: to.flatMap((entry) =>
        isRecord(entry) && typeof entry['Address'] === 'string' ? [entry['Address']] : [],
      ),
    };
  }
  throw new Error('Mailpit: unexpected search result.');
}

async function messageHtml(id: string): Promise<string> {
  const body = await getJson(`/api/v1/message/${id}`);
  if (isRecord(body) && typeof body['HTML'] === 'string') return body['HTML'];
  throw new Error('Mailpit: unexpected message format.');
}

/**
 * Messages sent to `recipient` that arrived at or after `since`, oldest first. Mailpit keeps the
 * messages of earlier runs, so callers pass the instant just before their own request.
 */
export async function messagesTo(recipient: string, since: Date): Promise<MailpitMessage[]> {
  const query = encodeURIComponent(`to:"${recipient}"`);
  const body = await getJson(`/api/v1/search?query=${query}`);
  const messages = isRecord(body) && Array.isArray(body['messages']) ? body['messages'] : [];
  const wanted = recipient.toLowerCase();
  const matching = messages
    .map(toSummary)
    .filter((message) => message.to.some((address) => address.toLowerCase() === wanted))
    // Mailpit stores whole milliseconds: allow for the clock rounding of `since`.
    .filter((message) => Date.parse(message.created) >= since.getTime() - 1000)
    .toSorted((a, b) => Date.parse(a.created) - Date.parse(b.created));
  return Promise.all(
    matching.map(async (message) => ({
      id: message.id,
      subject: message.subject,
      created: new Date(message.created),
      html: await messageHtml(message.id),
    })),
  );
}

/** Waits for the first message to `recipient` that arrived at or after `since`. */
export async function waitForMessageTo(
  recipient: string,
  since: Date,
  timeoutMs = 10_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<MailpitMessage> => {
    const [first] = await messagesTo(recipient, since);
    if (first) return first;
    if (Date.now() > deadline) throw new Error(`No email to ${recipient} within ${timeoutMs} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return poll();
  };
  return poll();
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? entity;
  });
}

/** The decoded `href` of the link whose text is `label` (the button of the email template). */
export function linkHref(html: string, label: string): string {
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const [, attributes = '', inner = ''] = match;
    const text = decodeEntities(inner.replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (text !== label) continue;
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(attributes)?.[1];
    if (href !== undefined) return decodeEntities(href);
  }
  throw new Error(`No link "${label}" in the email.`);
}
