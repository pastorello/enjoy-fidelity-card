import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The error-code checks (scripts/*ErrorCodes.test.ts) compare the app's translation tables with the
// codes the database can raise today. Reading every migration whole would count codes of functions
// that a later migration replaced or dropped (SPEC-customers-v2: app.create_customer raised
// the phone's code until customers_v2_email redefined it). This replays the migrations in order and
// keeps, for each function still present, only its most recent definition.

export const MIGRATIONS = 'supabase/migrations';

/** The latest definition of a function still present after every migration. */
export interface LiveFunction {
  /** Schema-qualified name, e.g. `app.create_customer`. */
  name: string;
  /** The migration file (name only) holding the latest definition. */
  file: string;
  /** The text of that definition, from `create` to the end of its `$$` body. */
  text: string;
}

const STATEMENT =
  /^\s*(create(?:\s+or\s+replace)?\s+function|drop\s+function(?:\s+if\s+exists)?)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(/gm;

/** The definition starting at `start`: through the closing `$$` of its body. */
function definitionAt(text: string, start: number): string {
  const open = text.indexOf('$$', start);
  const close = open === -1 ? -1 : text.indexOf('$$', open + 2);
  if (close === -1) throw new Error(`function body without $$ at offset ${String(start)}`);
  return text.slice(start, close + 2);
}

/**
 * Every function present after all the migrations, with its latest definition. Overloads share one
 * name: the migrations always drop the old signature before creating the new one, so the name is
 * the key. A function a migration drops and never recreates is left out.
 */
export function liveFunctions(dir: string = MIGRATIONS): LiveFunction[] {
  const live = new Map<string, LiveFunction>();
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .toSorted((a, b) => a.localeCompare(b));
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const match of text.matchAll(STATEMENT)) {
      const verb = match[1] ?? '';
      const name = match[2] ?? '';
      if (verb.startsWith('drop')) live.delete(name);
      else live.set(name, { name, file, text: definitionAt(text, match.index) });
    }
  }
  return [...live.values()];
}

/** The live functions whose latest definition is in a migration whose name matches `pattern`. */
export function liveFunctionsIn(pattern: RegExp, dir: string = MIGRATIONS): LiveFunction[] {
  const found = liveFunctions(dir).filter((fn) => pattern.test(fn.file));
  if (found.length === 0)
    throw new Error(`no live function in a migration matching ${String(pattern)}`);
  return found;
}

/** The message-codes `functions` raise with errcode P0001, sorted, once each. */
export function raisedMessageCodes(functions: readonly LiveFunction[]): string[] {
  const codes = functions.flatMap((fn) =>
    [...fn.text.matchAll(/raise exception '([a-z_]+)'\s+using errcode = 'P0001'/g)].map(
      (match) => match[1] ?? '',
    ),
  );
  return [...new Set(codes)].toSorted((a, b) => a.localeCompare(b));
}
