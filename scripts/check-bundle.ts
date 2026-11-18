// Usage: npm run build && npm run check:bundle
// SPEC-card-input, success criterion 8: the E2E fake card reader (window.__enjoyFakeCard*, chunk
// fakeCardAdapter) must never reach a published build. Fails if dist/ (JS chunks, service worker and its
// precache manifest, HTML) still carries it, e.g. because the build ran with VITE_E2E=1.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** `__enjoyFakeCard` is also the prefix of `__enjoyFakeCardWrites` and `__enjoyFakeCardControl`. */
const NEEDLES = ['__enjoyFakeCard', 'fakeCardAdapter'] as const;

/** Files whose text can load or name a chunk: JS (service worker included), HTML, manifests, maps. */
const TEXT_FILE = /\.(js|mjs|cjs|html|json|webmanifest|map)$/;

export type Trace = { file: string; needle: (typeof NEEDLES)[number] };

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

/** Every file of `distDir` that names or contains the fake adapter, sorted by file then needle. */
export function findFakeAdapterTraces(distDir: string): Trace[] {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error(`${distDir}/ not found: run \`npm run build\` before \`npm run check:bundle\``);
  }
  return listFiles(distDir)
    .map((path) => ({ path, file: relative(distDir, path).split('\\').join('/') }))
    .toSorted((a, b) => a.file.localeCompare(b.file))
    .flatMap(({ path, file }) => {
      const text = TEXT_FILE.test(file) ? readFileSync(path, 'utf8') : '';
      return NEEDLES.filter((needle) => file.includes(needle) || text.includes(needle)).map(
        (needle) => ({ file, needle }),
      );
    });
}

if (import.meta.main) {
  try {
    const traces = findFakeAdapterTraces('dist');
    if (traces.length > 0) {
      console.error('check:bundle: the E2E fake card reader is in dist/ (built with VITE_E2E=1?)');
      for (const { file, needle } of traces) console.error(`  dist/${file}: ${needle}`);
      process.exit(1);
    }
    console.log('check:bundle: dist/ has no trace of the fake card reader');
  } catch (error) {
    console.error(`check:bundle: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
