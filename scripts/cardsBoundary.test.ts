import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC-cards, "Code Style" and "Boundaries": components use CardsService through useCardsService(),
// never getSupabase(); only supabaseCardsService.ts reads app.cards or calls the cards RPCs, and only
// public/cardPointsService.ts calls public.card_points and public.card_rewards (POSTs: never
// `{ get: true }`, which would put the token in the request URL). The module never logs (uids, tokens and link URLs), never stores
// anything in the browser, never reads location.href (the token is in the public page's path) and
// never locks a card (makeReadOnly).

const SRC = 'src';
const MODULE = 'src/features/cards/';
const SERVICE = 'src/features/cards/supabaseCardsService.ts';
const PUBLIC_SERVICE = 'src/features/cards/public/cardPointsService.ts';
const MAIN = 'src/main.tsx';
const RPCS = [
  'lookup_card',
  'associate_card',
  'deactivate_card',
  'create_customer_with_card',
  'issue_card_link',
  'confirm_card_link',
];
// Test support (fake services and fake NDEFReader): never imported by the app, never in a build.
const TEST_SUPPORT = 'src/test/';

type SourceFile = { path: string; text: string };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [relative('.', path).split('\\').join('/')];
  });
}

/** The code without its comments, string literals kept: a doc comment may name `issue_card_link`. */
function stripComments(text: string): string {
  return text.replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)/g,
    (match, literal: string | undefined) => literal ?? '',
  );
}

function appFiles(files: readonly SourceFile[]): SourceFile[] {
  return files.filter((file) => !file.path.startsWith(TEST_SUPPORT));
}

/** Files that call getSupabase() inside the cards module, other than its two services. */
export function supabaseOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => file.path.startsWith(MODULE))
    .filter((file) => file.path !== SERVICE && file.path !== PUBLIC_SERVICE)
    .filter((file) => /\bgetSupabase\b/.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** Files that read app.cards or name a cards RPC in their code. */
export function rpcCallers(files: readonly SourceFile[]): string[] {
  const access = new RegExp(`\\.from\\(\\s*['"\`]cards['"\`]|['"\`](${RPCS.join('|')})['"\`]`);
  return appFiles(files)
    .filter((file) => access.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** The public page's functions: the only ones anon may execute. */
const PUBLIC_RPC = /['"`](card_points|card_rewards)['"`]/;

/** Files that name public.card_points or public.card_rewards in their code. */
export function cardPointsCallers(files: readonly SourceFile[]): string[] {
  return appFiles(files)
    .filter((file) => PUBLIC_RPC.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** Files that call a public function with `{ get: true }` (the token would travel in the URL). */
export function getRequestOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => {
      const code = stripComments(file.text);
      return PUBLIC_RPC.test(code) && /\bget\s*:\s*true\b/.test(code);
    })
    .map((file) => file.path);
}

const MODULE_BANS = [
  { name: 'console', pattern: /\bconsole\s*\??\./ },
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { name: 'location.href', pattern: /\blocation\s*\??\.\s*href\b/ },
] as const;

/** `path: what` for every cards file that logs, stores in the browser or reads location.href. */
export function moduleOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => file.path.startsWith(MODULE))
    .flatMap((file) => {
      const code = stripComments(file.text);
      return MODULE_BANS.filter((ban) => ban.pattern.test(code)).map(
        (ban) => `${file.path}: ${ban.name}`,
      );
    });
}

/** App files that call makeReadOnly() (an irreversible lock: SPEC-cards, "Ask first"). */
export function readOnlyOffenders(files: readonly SourceFile[]): string[] {
  return appFiles(files)
    .filter((file) => /\bmakeReadOnly\b/.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** Files that import the Supabase cards service, other than main.tsx (where it is injected). */
export function serviceImportOffenders(files: readonly SourceFile[]): string[] {
  const importer = /from\s+['"][^'"]*\/supabaseCardsService['"]/;
  return files
    .filter((file) => file.path !== MAIN && importer.test(stripComments(file.text)))
    .map((file) => file.path);
}

const files: SourceFile[] = sourceFiles(SRC).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

describe('cards boundary', () => {
  it('finds the application sources', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toContain(SERVICE);
    expect(paths).toContain(PUBLIC_SERVICE);
    expect(paths).toContain('src/features/cards/public/CardPointsPage.tsx');
  });

  it('keeps getSupabase() in the two cards services only', () => {
    expect(supabaseOffenders(files)).toEqual([]);
  });

  it('lets only supabaseCardsService.ts read app.cards or call the cards RPCs', () => {
    expect(rpcCallers(files)).toEqual([SERVICE]);
  });

  it('lets only cardPointsService.ts call card_points and card_rewards, never with { get: true }', () => {
    expect(cardPointsCallers(files)).toEqual([PUBLIC_SERVICE]);
    expect(getRequestOffenders(files)).toEqual([]);
  });

  it('imports the Supabase cards service only where it is injected (main.tsx)', () => {
    expect(serviceImportOffenders(files)).toEqual([]);
  });

  it('never logs, stores in the browser or reads location.href inside cards', () => {
    expect(moduleOffenders(files)).toEqual([]);
  });

  it('never calls makeReadOnly', () => {
    expect(readOnlyOffenders(files)).toEqual([]);
  });
});

describe('cards boundary guard (self-test)', () => {
  const component = 'src/features/cards/Example.tsx';

  it('fails when a component calls Supabase', () => {
    const example = [
      { path: component, text: "const { data } = await getSupabase().rpc('lookup_card');" },
    ];
    expect(supabaseOffenders(example)).toEqual([component]);
    expect(rpcCallers(example)).toEqual([component]);
  });

  it('fails when a component logs a uid or a link URL', () => {
    expect(moduleOffenders([{ path: component, text: 'console.log(uid);' }])).toEqual([
      `${component}: console`,
    ]);
    expect(moduleOffenders([{ path: component, text: 'console?.info(cardLinkUrl(t));' }])).toEqual([
      `${component}: console`,
    ]);
    expect(moduleOffenders([{ path: component, text: 'report(window.location.href);' }])).toEqual([
      `${component}: location.href`,
    ]);
    expect(moduleOffenders([{ path: component, text: "localStorage.setItem('t', t);" }])).toEqual([
      `${component}: localStorage`,
    ]);
  });

  it('fails on card_points or card_rewards with { get: true } and on makeReadOnly', () => {
    const getCall = "rpc('card_points', { p_token: token }, { get: true })";
    expect(getRequestOffenders([{ path: PUBLIC_SERVICE, text: getCall }])).toEqual([
      PUBLIC_SERVICE,
    ]);
    const getRewards = "rpc('card_rewards', { p_token: token }, { get: true })";
    expect(getRequestOffenders([{ path: PUBLIC_SERVICE, text: getRewards }])).toEqual([
      PUBLIC_SERVICE,
    ]);
    expect(cardPointsCallers([{ path: component, text: "rpc('card_rewards', {})" }])).toEqual([
      component,
    ]);
    expect(readOnlyOffenders([{ path: component, text: 'await writer.makeReadOnly();' }])).toEqual([
      component,
    ]);
  });

  it('ignores comments that name what they do not call', () => {
    const text =
      '// never console.log(uid), never makeReadOnly(), never getSupabase()\nconst a = 1;';
    const example = [{ path: component, text }];
    expect(supabaseOffenders(example)).toEqual([]);
    expect(moduleOffenders(example)).toEqual([]);
    expect(readOnlyOffenders(example)).toEqual([]);
  });
});
