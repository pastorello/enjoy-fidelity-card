import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Task 12 of tasks/customers-v2: the E2E specs reach the search field of the home through one helper
// (`homeSearch` in e2e/fixtures.ts), so a change of its label (task 13) touches one place only.

const E2E = 'e2e';
const HELPER = 'fixtures.ts';
/** Any spelling of the field's label, with or without «Oppure», whatever it searches by. */
const LABEL = /cerca per nome o /i;

const specs = () => readdirSync(E2E).filter((name) => name.endsWith('.ts') && name !== HELPER);

describe('the home search field in the E2E', () => {
  it('is named only by the helper in e2e/fixtures.ts', () => {
    const naming = specs().filter((name) => LABEL.test(readFileSync(`${E2E}/${name}`, 'utf8')));
    expect(naming).toEqual([]);
  });

  it('has the helper', () => {
    expect(readFileSync(`${E2E}/${HELPER}`, 'utf8')).toMatch(/export function homeSearch\(/);
  });
});
