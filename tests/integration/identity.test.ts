import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localSupabase, memoryClient, runSql } from './localSupabase';

const local = localSupabase();
const admin = memoryClient(local.url, local.secretKey);

/** A throwaway operator, so the seed accounts used by E2E are never touched. */
const email = `integrazione-${randomUUID()}@example.com`;
const password = randomBytes(18).toString('base64url');
const name = `Integrazione ${randomUUID().slice(0, 8)}`;
let userId: string | undefined;

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
  runSql(`select private.add_operator(:'email', :'name', 'operator');`, { email, name });
});

afterAll(async () => {
  // The profile outlives its Auth user by design: remove it so other suites see the seed only.
  runSql(`delete from app.operators where name = :'name';`, { name });
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('removed account', () => {
  it('signs in, and the old access token no longer reads operators once the user is deleted', async () => {
    const client = memoryClient(local.url, local.publishableKey);
    const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    });
    expect(signInError).toBeNull();
    expect(signIn.session?.access_token).toBeTruthy();

    const before = await client.schema('app').from('operators').select('name, role');
    expect(before.error).toBeNull();
    expect(before.data).toContainEqual({ name, role: 'operator' });

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId ?? '');
    expect(deleteError).toBeNull();
    userId = undefined;

    // Same client, same (still unexpired) access token.
    const after = await client.schema('app').from('operators').select('name, role');
    expect(after.error).toBeNull();
    expect(after.data).toEqual([]);

    // The profile is kept for history, unlinked from the deleted user.
    expect(
      runSql(`select count(*) from app.operators where name = :'name' and user_id is null;`, {
        name,
      }),
    ).toBe('1');

    // And the session cannot be renewed: the app shows "La sessione è scaduta".
    const { error: refreshError } = await client.auth.refreshSession();
    expect(refreshError).not.toBeNull();
  });
});

describe('secret key', () => {
  it('never appears in the app source', () => {
    // src/lib/supabase.ts may mention the `sb_secret_` prefix (it refuses such keys), never a key.
    const offenders = sourceFiles('src').filter((path) =>
      readFileSync(path, 'utf8').includes(local.secretKey),
    );
    expect(offenders).toEqual([]);
  });
});
