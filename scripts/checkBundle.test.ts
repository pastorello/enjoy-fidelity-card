import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findFakeAdapterTraces } from './check-bundle.ts';

// SPEC-card-input, success criterion 8: the published build never carries the E2E fake card reader.

let dist: string;

function write(path: string, text: string) {
  const full = join(dist, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
}

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'check-bundle-'));
  write('index.html', '<script type="module" src="/assets/index-abc123.js"></script>');
  write('assets/index-abc123.js', 'const ready = true; export { ready };');
  write('sw.js', 'precacheAndRoute([{url:"assets/index-abc123.js",revision:null}]);');
  write('assets/index-abc123.css', 'body { margin: 0 }');
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('findFakeAdapterTraces', () => {
  it('reports nothing for a clean build', () => {
    expect(findFakeAdapterTraces(dist)).toEqual([]);
  });

  it('finds the fake reader global inside a JS chunk', () => {
    write('assets/main-def456.js', 'window.__enjoyFakeCardWrites = [];');
    expect(findFakeAdapterTraces(dist)).toEqual([
      { file: 'assets/main-def456.js', needle: '__enjoyFakeCard' },
    ]);
  });

  it('finds the fake adapter chunk in the service worker precache manifest', () => {
    write('sw.js', 'precacheAndRoute([{url:"assets/fakeCardAdapter-0a1b2c.js",revision:null}]);');
    expect(findFakeAdapterTraces(dist)).toEqual([{ file: 'sw.js', needle: 'fakeCardAdapter' }]);
  });

  it('finds a chunk named after the fake adapter even when its content is clean', () => {
    write('assets/fakeCardAdapter-0a1b2c.js', 'export {};');
    expect(findFakeAdapterTraces(dist)).toEqual([
      { file: 'assets/fakeCardAdapter-0a1b2c.js', needle: 'fakeCardAdapter' },
    ]);
  });

  it('lists every file and every needle it finds, sorted by file', () => {
    write('sw.js', 'precacheAndRoute([{url:"assets/fakeCardAdapter-0a1b2c.js"}]);');
    write('assets/fakeCardAdapter-0a1b2c.js', 'window.__enjoyFakeCard = () => {};');
    expect(findFakeAdapterTraces(dist)).toEqual([
      { file: 'assets/fakeCardAdapter-0a1b2c.js', needle: '__enjoyFakeCard' },
      { file: 'assets/fakeCardAdapter-0a1b2c.js', needle: 'fakeCardAdapter' },
      { file: 'sw.js', needle: 'fakeCardAdapter' },
    ]);
  });

  it('fails when dist/ does not exist (the build has not run)', () => {
    rmSync(dist, { recursive: true, force: true });
    expect(() => findFakeAdapterTraces(dist)).toThrow(/npm run build/);
  });
});
