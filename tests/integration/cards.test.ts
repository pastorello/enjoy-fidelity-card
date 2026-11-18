import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { supabaseCardsService as service } from '../../src/features/cards/supabaseCardsService';
import { CardTakenError } from '../../src/features/cards/types';
import { supabaseCustomerService as customers } from '../../src/features/customers/supabaseCustomerService';
import { localSupabase, memoryClient, runSql } from './localSupabase';

// The services under test talk to whichever signed-in client the test sets here.
const current = vi.hoisted(() => ({ client: undefined as SupabaseClient | undefined }));
vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => {
    if (!current.client) throw new Error('No client selected for this test');
    return current.client;
  },
}));

const local = localSupabase();
// Seed accounts (supabase/seed.sql): signing in does not change them.
const SEED_PASSWORD = 'password-di-prova';
// Customers and cards are never deleted: every run uses names and uids of its own, so the suite
// repeats without db:reset.
const SUFFIX = randomBytes(4).toString('hex');

/** A fresh canonical uid (7 bytes, like an NTAG215), never one an earlier run used. */
function newUid(): string {
  return `04${randomBytes(6).toString('hex').toUpperCase()}`;
}

/** Customers this run made: anonymized at the end (their cards are deactivated with them). */
const toErase: string[] = [];

async function newCustomer(label: string): Promise<string> {
  const created = await customers.create({
    operationId: randomUUID(),
    name: `Card ${label} ${SUFFIX}`,
    phone: '',
    privacyConsent: true,
    notes: '',
  });
  toErase.push(created.id);
  return created.id;
}

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = memoryClient(local.url, local.publishableKey);
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

/** `public.card_points` as the public page calls it: POST, the anon key only, no session. */
async function cardPointsOverHttp(token: unknown) {
  const response = await fetch(`${local.url}/rest/v1/rpc/card_points`, {
    method: 'POST',
    headers: { apikey: local.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
  });
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    contentType: response.headers.get('content-type'),
    body: await response.text(),
  };
}

let adminClient: SupabaseClient;
let operatorClient: SupabaseClient;

beforeAll(async () => {
  adminClient = await signedIn('admin@example.com');
  operatorClient = await signedIn('operatore@example.com');
});

afterAll(async () => {
  current.client = adminClient;
  await Promise.all(toErase.map((id) => customers.anonymize(id)));
});

describe('concurrent associations (criterion 4)', () => {
  // A race is microseconds wide: several rounds, each with fresh rows, make it happen every run.
  const ROUNDS = 8;

  beforeAll(() => {
    current.client = operatorClient;
  });

  /** Runs `round` ROUNDS times, one after the other, so every round is a fresh race. */
  async function rounds<T>(round: (index: number) => Promise<T>, index = 0): Promise<T[]> {
    if (index === ROUNDS) return [];
    const result = await round(index);
    return [result, ...(await rounds(round, index + 1))];
  }

  it('one uid to two customers at once: one succeeds, the other is card_taken', async () => {
    const outcomes = await rounds(async (index) => {
      const uid = newUid();
      const [first, second] = await Promise.all([
        newCustomer(`gara A${index}`),
        newCustomer(`gara B${index}`),
      ]);
      const settled = await Promise.allSettled([
        service.associate(first, uid),
        service.associate(second, uid),
      ]);
      expect(runSql(`select count(*) from app.cards where uid = :'uid';`, { uid })).toBe('1');
      const winners = settled.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value.card.customerId] : [],
      );
      const losers = settled.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      // The loser learns who owns the card now.
      expect(winners).toHaveLength(1);
      expect(losers.map((loser) => loser instanceof CardTakenError)).toEqual([true]);
      expect(losers).toMatchObject([{ owner: { customerId: winners[0], active: true } }]);
      return { winners: winners.length, losers: losers.length };
    });
    expect(outcomes).toEqual(Array.from({ length: ROUNDS }, () => ({ winners: 1, losers: 1 })));
  });

  it('two uids to one customer at once: both succeed, one active card at the end', async () => {
    await rounds(async (index) => {
      const customerId = await newCustomer(`doppia ${index}`);
      const uids = [newUid(), newUid()];
      const results = await Promise.all(uids.map((uid) => service.associate(customerId, uid)));
      expect(
        runSql(`select count(*) from app.cards where customer_id = :'id'::uuid and active;`, {
          id: customerId,
        }),
      ).toBe('1');
      // They ran one after the other: the second replaced the first.
      expect(results.filter((result) => result.replacedCardId !== null)).toHaveLength(1);
      const active = await service.getActiveCard(customerId);
      expect(uids).toContain(active?.uid);
    });
  });
});

describe('error codes from the real server', () => {
  let customerId = '';
  let otherId = '';

  beforeAll(async () => {
    current.client = operatorClient;
    customerId = await newCustomer('codici');
    otherId = await newCustomer('codici altro');
  });

  it('card_taken carries the owner: id, name and whether the card is active', async () => {
    const uid = newUid();
    await service.associate(otherId, uid);
    await expect(service.associate(customerId, uid)).rejects.toMatchObject({
      kind: 'card_taken',
      owner: { customerId: otherId, name: `Card codici altro ${SUFFIX}`, active: true },
    });
  });

  it('invalid_uid, customer_not_found and card_not_found', async () => {
    await expect(service.associate(customerId, '04:a1:b2')).rejects.toMatchObject({
      kind: 'invalid_uid',
    });
    await expect(service.lookup('04a1b2c3')).rejects.toMatchObject({ kind: 'invalid_uid' });
    await expect(service.associate(randomUUID(), newUid())).rejects.toMatchObject({
      kind: 'customer_not_found',
    });
    await expect(service.deactivate(randomUUID())).rejects.toMatchObject({
      kind: 'card_not_found',
    });
    await expect(service.issueLink(randomUUID())).rejects.toMatchObject({
      kind: 'card_not_found',
    });
  });

  it('card_inactive: no link for a deactivated card', async () => {
    const { card } = await service.associate(customerId, newUid());
    await service.deactivate(card.id);
    await expect(service.issueLink(card.id)).rejects.toMatchObject({ kind: 'card_inactive' });
  });

  it('link_token_mismatch: an older token after a newer one was issued', async () => {
    const { card } = await service.associate(customerId, newUid());
    const older = await service.issueLink(card.id);
    const newer = await service.issueLink(card.id);
    expect(newer).not.toBe(older);
    await expect(service.confirmLink(card.id, older)).rejects.toMatchObject({
      kind: 'link_token_mismatch',
    });
    await expect(service.confirmLink(card.id, newer)).resolves.toMatchObject({
      id: card.id,
      linkState: 'written',
    });
  });

  it('customer_anonymized: an erased customer gets no card', async () => {
    current.client = adminClient;
    const erased = await newCustomer('cancellato');
    await customers.anonymize(erased);
    current.client = operatorClient;
    await expect(service.associate(erased, newUid())).rejects.toMatchObject({
      kind: 'customer_anonymized',
    });
  });

  it('lookup tells unknown, active and deactivated cards apart', async () => {
    const uid = newUid();
    await expect(service.lookup(uid)).resolves.toEqual({ status: 'unknown' });
    const { card } = await service.associate(customerId, uid);
    await expect(service.lookup(uid)).resolves.toEqual({
      status: 'active',
      cardId: card.id,
      customerId,
      customerName: `Card codici ${SUFFIX}`,
    });
    await service.deactivate(card.id);
    await expect(service.lookup(uid)).resolves.toMatchObject({ status: 'inactive' });
  });
});

describe('card_points over HTTP with the anon key (criterion 12)', () => {
  let validToken = '';
  let deactivatedToken = '';

  beforeAll(async () => {
    current.client = operatorClient;
    const customerId = await newCustomer('pagina pubblica');
    const kept = await service.associate(customerId, newUid());
    validToken = await service.issueLink(kept.card.id);
    await service.confirmLink(kept.card.id, validToken);

    const otherId = await newCustomer('pagina pubblica persa');
    const lost = await service.associate(otherId, newUid());
    deactivatedToken = await service.issueLink(lost.card.id);
    await service.confirmLink(lost.card.id, deactivatedToken);
    await service.deactivate(lost.card.id);
  });

  it('a valid token answers only the number of points, never cached', async () => {
    const answer = await cardPointsOverHttp(validToken);
    expect(answer).toMatchObject({ status: 200, cacheControl: 'no-store' });
    expect(answer.body).toBe('0');
  });

  it('a token that never existed and one of a deactivated card answer the same null', async () => {
    const never = await cardPointsOverHttp(randomBytes(16).toString('base64url'));
    const deactivated = await cardPointsOverHttp(deactivatedToken);
    expect(never).toMatchObject({ status: 200, cacheControl: 'no-store', body: 'null' });
    expect(deactivated).toEqual(never);
  });

  it('a malformed token is the same null, never an error', async () => {
    const never = await cardPointsOverHttp(randomBytes(16).toString('base64url'));
    const malformed = [validToken.slice(1), `${validToken}A`, `${validToken.slice(1)}+`, null];
    const answers = await Promise.all(malformed.map((token) => cardPointsOverHttp(token)));
    expect(answers).toEqual(malformed.map(() => never));
  });

  it('the anon key reads nothing else: no cards, no links, no other RPC', async () => {
    const anon = memoryClient(local.url, local.publishableKey);
    const cards = await anon.schema('app').from('cards').select('id').limit(1);
    expect(cards.data ?? []).toEqual([]);
    const issue = await anon.schema('app').rpc('issue_card_link', { p_card_id: randomUUID() });
    expect(issue.error).not.toBeNull();
    expect(issue.data).toBeNull();
  });
});
