import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../lib/serverFault';
import type { InviteInput } from '../features/operators/types';
import { createFakeOperatorsService, fakeOperator } from './fakeOperatorsService';

const ANNA = fakeOperator({ name: 'Anna Prova', role: 'admin', email: 'anna@esempio.it' });
const BRUNO = fakeOperator({ name: 'Bruno Prova', role: 'admin', email: 'bruno@esempio.it' });
const CARLA = fakeOperator({ name: 'carla Prova', email: 'carla@esempio.it', hasPin: true });
const DARIO = fakeOperator({
  name: 'Dario Prova',
  email: 'dario@esempio.it',
  emailConfirmed: false,
  hasPassword: false,
});
const ELSA = fakeOperator({ name: 'Elsa Prova', email: 'elsa@esempio.it', deactivated: true });
const FABIO = fakeOperator({ name: 'Fabio Prova', email: null });
const DEVICE_EMAIL = 'cassa@esempio.it';

/** Anna (admin, on her phone) looks at six people: every status. */
function setUp(options: Parameters<typeof createFakeOperatorsService>[0] = {}) {
  return createFakeOperatorsService({
    operators: [FABIO, ELSA, DARIO, CARLA, BRUNO, ANNA],
    actingId: ANNA.id,
    deviceEmails: [DEVICE_EMAIL],
    ...options,
  });
}

let nextOperation = 0;
function invite(overrides: Partial<InviteInput> = {}): InviteInput {
  nextOperation += 1;
  return {
    operationId: `00000000-0000-4000-a000-${String(nextOperation).padStart(12, '0')}`,
    name: 'Gino Prova',
    email: 'gino@esempio.it',
    role: 'operator',
    ...overrides,
  };
}

async function namesAndStatuses(fake: ReturnType<typeof setUp>) {
  const result = await fake.service.list();
  if (result.status !== 'ok') throw new Error(`list: ${result.status}`);
  return result.operators.map((operator) => `${operator.name}: ${operator.status}`);
}

describe('fakeOperator', () => {
  it('builds active operators with fake names, fresh UUID-shaped ids and fake emails', () => {
    const a = fakeOperator();
    const b = fakeOperator();
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).toMatchObject({ role: 'operator', deactivated: false, hasPin: false });
    expect(a.name).toMatch(/Prova/);
    expect(a.email).toMatch(/@esempio\.it$/);
  });
});

describe('list', () => {
  it('computes the statuses, orders alphabetically with deactivated and removed last, marks me', async () => {
    const fake = setUp();
    const result = await fake.service.list();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.operators.map((o) => [o.name, o.status, o.isMe])).toEqual([
      ['Anna Prova', 'active', true],
      ['Bruno Prova', 'active', false],
      ['carla Prova', 'active', false],
      ['Dario Prova', 'invited', false],
      ['Elsa Prova', 'deactivated', false],
      ['Fabio Prova', 'removed', false],
    ]);
    expect(result.operators.find((o) => o.id === FABIO.id)?.email).toBeNull();
    expect(result.operators.find((o) => o.id === CARLA.id)).toMatchObject({
      email: 'carla@esempio.it',
      hasPin: true,
      role: 'operator',
    });
  });

  it('counts as invited a confirmed email without a password', async () => {
    const half = fakeOperator({ name: 'Ugo Prova', hasPassword: false });
    const fake = setUp({ operators: [ANNA, half] });
    expect(await namesAndStatuses(fake)).toEqual(['Anna Prova: active', 'Ugo Prova: invited']);
  });

  it('is forbidden to an operator, a deactivated admin and a device without an admin cashier', async () => {
    expect(await setUp({ actingId: CARLA.id }).service.list()).toEqual({ status: 'forbidden' });
    expect(await setUp({ actingId: ELSA.id }).service.list()).toEqual({ status: 'forbidden' });
    expect(await setUp({ actingId: null, onDevice: true }).service.list()).toEqual({
      status: 'forbidden',
    });
    expect((await setUp({ actingId: ANNA.id, onDevice: true }).service.list()).status).toBe('ok');
  });
});

describe('setRole', () => {
  it('changes the role and returns the row; the same role writes nothing and answers the same', async () => {
    const fake = setUp();
    const promoted = await fake.service.setRole(CARLA.id, 'admin');
    expect(promoted).toMatchObject({ status: 'ok', operator: { id: CARLA.id, role: 'admin' } });
    expect(await fake.service.setRole(CARLA.id, 'admin')).toEqual(promoted);
  });

  it('refuses in the order of the server: forbidden, not-found, self, no-account', async () => {
    expect(await setUp({ actingId: CARLA.id }).service.setRole('missing', 'admin')).toEqual({
      status: 'forbidden',
    });
    const fake = setUp();
    expect(await fake.service.setRole('missing', 'admin')).toEqual({ status: 'not-found' });
    expect(await fake.service.setRole(ANNA.id, 'operator')).toEqual({ status: 'self' });
    expect(await fake.service.setRole(FABIO.id, 'admin')).toEqual({ status: 'no-account' });
  });

  it('never names an admin from a device, even with an admin cashier', async () => {
    const fake = setUp({ onDevice: true });
    expect(await fake.service.setRole(CARLA.id, 'admin')).toEqual({ status: 'admin-from-device' });
    expect(await fake.service.setRole(BRUNO.id, 'operator')).toMatchObject({ status: 'ok' });
  });

  it('two admins demoting each other: the second one is no admin any more (forbidden)', async () => {
    const fake = setUp({ operators: [ANNA, BRUNO], actingId: ANNA.id });
    expect(await fake.service.setRole(BRUNO.id, 'operator')).toMatchObject({ status: 'ok' });
    fake.setCaller({ actingId: BRUNO.id });
    expect(await fake.service.setRole(ANNA.id, 'operator')).toEqual({ status: 'forbidden' });
  });

  it('answers last-admin when the target is the only other accepted admin of a cashier', async () => {
    // A device with an admin cashier who has not accepted (cannot happen on a phone): the race of
    // the spec, reproduced as the server would see it.
    const cashier = fakeOperator({ name: 'Ivo Prova', role: 'admin', hasPassword: false });
    const fake = setUp({ operators: [ANNA, cashier], actingId: cashier.id, onDevice: true });
    expect(await fake.service.setRole(ANNA.id, 'operator')).toEqual({ status: 'last-admin' });
    expect(await fake.service.setActive(ANNA.id, false)).toEqual({ status: 'last-admin' });
  });
});

describe('setActive', () => {
  it('deactivates and reactivates, idempotent on the same state', async () => {
    const fake = setUp();
    expect(await fake.service.setActive(CARLA.id, false)).toMatchObject({
      status: 'ok',
      operator: { id: CARLA.id, status: 'deactivated', hasPin: true },
    });
    expect(await fake.service.setActive(CARLA.id, false)).toMatchObject({
      operator: { status: 'deactivated' },
    });
    expect(await fake.service.setActive(CARLA.id, true)).toMatchObject({
      operator: { status: 'active' },
    });
    expect(await fake.service.setActive(ELSA.id, true)).toMatchObject({
      operator: { status: 'active' },
    });
  });

  it('a reactivated person who never accepted is invited again', async () => {
    const fake = setUp();
    await fake.service.setActive(DARIO.id, false);
    expect(await fake.service.setActive(DARIO.id, true)).toMatchObject({
      operator: { status: 'invited' },
    });
  });

  it('refuses self, removed, unknown and non-admins', async () => {
    const fake = setUp();
    expect(await fake.service.setActive(ANNA.id, false)).toEqual({ status: 'self' });
    expect(await fake.service.setActive(FABIO.id, true)).toEqual({ status: 'no-account' });
    expect(await fake.service.setActive('missing', true)).toEqual({ status: 'not-found' });
    expect(await setUp({ actingId: DARIO.id }).service.setActive(CARLA.id, false)).toEqual({
      status: 'forbidden',
    });
  });

  it('a deactivated admin loses the access at once', async () => {
    const fake = setUp({ operators: [ANNA, BRUNO], actingId: ANNA.id });
    await fake.service.setActive(BRUNO.id, false);
    fake.setCaller({ actingId: BRUNO.id });
    expect(await fake.service.list()).toEqual({ status: 'forbidden' });
  });
});

describe('invite', () => {
  it('creates an invited profile, sends one invite email and returns the brief', async () => {
    const fake = setUp();
    const result = await fake.service.invite(invite({ name: '  Gino   Prova ', role: 'admin' }));
    expect(result).toMatchObject({
      status: 'invited',
      operator: { name: 'Gino Prova', role: 'admin' },
    });
    expect(fake.emails).toEqual([
      { kind: 'invite', to: 'gino@esempio.it', name: 'Gino Prova', invitedBy: 'Anna Prova' },
    ]);
    expect(await namesAndStatuses(fake)).toContain('Gino Prova: invited');
  });

  it('is idempotent on operationId: the same request twice sends one email, same profile', async () => {
    const fake = setUp();
    const input = invite({ email: ' Gino@Esempio.IT ' });
    const first = await fake.service.invite(input);
    expect(await fake.service.invite(input)).toEqual(first);
    expect(fake.emails).toHaveLength(1);
    expect(fake.emails[0]?.to).toBe('gino@esempio.it');
  });

  it('the same operationId with other fields is refused as unknown (22023)', async () => {
    const fake = setUp();
    const input = invite();
    await fake.service.invite(input);
    expect(await fake.service.invite({ ...input, role: 'admin' })).toEqual({ status: 'unknown' });
  });

  it('an answer lost after the invite was sent: a retry with the same id answers invited', async () => {
    const fake = setUp();
    const input = invite();
    fake.failNext('invite', 'lost');
    expect(await fake.service.invite(input)).toEqual({ status: 'network' });
    expect(await fake.service.invite(input)).toMatchObject({ status: 'invited' });
    expect(fake.emails).toHaveLength(1);
  });

  it('refuses a taken name (case-insensitive), a taken email and the email of a device', async () => {
    const fake = setUp();
    expect(await fake.service.invite(invite({ name: 'CARLA prova' }))).toEqual({
      status: 'name-taken',
    });
    expect(await fake.service.invite(invite({ email: 'Carla@esempio.it' }))).toEqual({
      status: 'email-taken',
      deactivated: false,
    });
    expect(await fake.service.invite(invite({ email: 'elsa@esempio.it' }))).toEqual({
      status: 'email-taken',
      deactivated: true,
    });
    expect(await fake.service.invite(invite({ email: DEVICE_EMAIL }))).toEqual({
      status: 'email-is-device',
    });
    expect(fake.emails).toEqual([]);
  });

  it('a refused reservation can be retried with the same id once the conflict is gone', async () => {
    const fake = setUp();
    const input = invite({ email: 'dario@esempio.it', name: 'Dario Bis Prova' });
    expect(await fake.service.invite(input)).toMatchObject({ status: 'email-taken' });
    await fake.service.cancelInvite(DARIO.id);
    expect(await fake.service.invite(input)).toMatchObject({ status: 'invited' });
  });

  it('relinks a removed profile with the same name, with the new role', async () => {
    const fake = setUp();
    const result = await fake.service.invite(invite({ name: 'fabio prova', role: 'admin' }));
    expect(result).toEqual({
      status: 'invited',
      operator: { id: FABIO.id, name: 'Fabio Prova', role: 'admin' },
    });
    expect(await namesAndStatuses(fake)).toContain('Fabio Prova: invited');
  });

  it('refuses an invalid input as unknown, before any email', async () => {
    const fake = setUp();
    for (const input of [
      invite({ name: '   ' }),
      invite({ name: 'x'.repeat(61) }),
      invite({ email: 'senza-chiocciola' }),
      invite({ email: `${'a'.repeat(250)}@b.it` }),
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one invalid input at a time, as the server sees them.
      expect(await fake.service.invite(input)).toEqual({ status: 'unknown' });
    }
    expect(fake.emails).toEqual([]);
  });

  it('never invites an admin from a device; an operator yes, with an admin cashier', async () => {
    const fake = setUp({ onDevice: true });
    expect(await fake.service.invite(invite({ role: 'admin' }))).toEqual({
      status: 'admin-from-device',
    });
    expect(await fake.service.invite(invite())).toMatchObject({ status: 'invited' });
  });

  it('is forbidden to an operator', async () => {
    const fake = setUp({ actingId: CARLA.id });
    expect(await fake.service.invite(invite())).toEqual({ status: 'forbidden' });
  });

  it('programmed answers of the function: in-progress, rate-limited, email-taken', async () => {
    const fake = setUp();
    fake.failNext('invite', 'in-progress');
    fake.failNext('invite', 'rate-limited');
    fake.failNext('invite', 'email-taken');
    expect(await fake.service.invite(invite())).toEqual({ status: 'in-progress' });
    expect(await fake.service.invite(invite())).toEqual({ status: 'rate-limited' });
    expect(await fake.service.invite(invite())).toEqual({
      status: 'email-taken',
      deactivated: false,
    });
    expect(fake.emails).toEqual([]);
  });
});

describe('resendInvite and cancelInvite', () => {
  it('resends to an invited person; a confirmed email without a password gets a recovery link', async () => {
    const half = fakeOperator({ name: 'Ugo Prova', email: 'ugo@esempio.it', hasPassword: false });
    const fake = setUp({ operators: [ANNA, DARIO, half] });
    expect(await fake.service.resendInvite(DARIO.id)).toEqual({ status: 'resent' });
    expect(await fake.service.resendInvite(DARIO.id)).toEqual({ status: 'resent' });
    expect(await fake.service.resendInvite(half.id)).toEqual({ status: 'resent' });
    expect(fake.emails.map((email) => `${email.kind} ${email.to}`)).toEqual([
      'invite dario@esempio.it',
      'invite dario@esempio.it',
      'recovery ugo@esempio.it',
    ]);
  });

  it('refuses who is not invited (active, deactivated, removed, unknown), oneself and non-admins', async () => {
    const fake = setUp();
    for (const id of [CARLA.id, ELSA.id, FABIO.id, 'missing']) {
      // oxlint-disable-next-line no-await-in-loop -- each refusal is independent.
      expect(await fake.service.resendInvite(id)).toEqual({ status: 'not-invited' });
      // oxlint-disable-next-line no-await-in-loop -- each refusal is independent.
      expect(await fake.service.cancelInvite(id)).toEqual({ status: 'not-invited' });
    }
    expect(await fake.service.resendInvite(ANNA.id)).toEqual({ status: 'self' });
    expect(await fake.service.cancelInvite(ANNA.id)).toEqual({ status: 'self' });
    const operator = setUp({ actingId: CARLA.id });
    expect(await operator.service.resendInvite(DARIO.id)).toEqual({ status: 'forbidden' });
    expect(await operator.service.cancelInvite(DARIO.id)).toEqual({ status: 'forbidden' });
    expect(fake.emails).toEqual([]);
  });

  it('cancelling removes the account: the profile stays, removed, and a resend is refused', async () => {
    const fake = setUp();
    expect(await fake.service.cancelInvite(DARIO.id)).toEqual({ status: 'cancelled' });
    expect(await namesAndStatuses(fake)).toContain('Dario Prova: removed');
    expect(await fake.service.resendInvite(DARIO.id)).toEqual({ status: 'not-invited' });
  });

  it('an invite accepted meanwhile is not invited any more', async () => {
    const fake = setUp();
    fake.acceptInvite(DARIO.id);
    expect(await fake.service.resendInvite(DARIO.id)).toEqual({ status: 'not-invited' });
    expect(await namesAndStatuses(fake)).toContain('Dario Prova: active');
  });

  it('programmed rate-limited on a resend sends nothing', async () => {
    const fake = setUp();
    fake.failNext('resendInvite', 'rate-limited');
    expect(await fake.service.resendInvite(DARIO.id)).toEqual({ status: 'rate-limited' });
    expect(fake.emails).toEqual([]);
  });
});

describe('failures, holds and the log', () => {
  it('network down: every method resolves network and changes nothing', async () => {
    const fake = setUp();
    fake.setNetworkDown(true);
    expect(await fake.service.list()).toEqual({ status: 'network' });
    expect(await fake.service.setActive(CARLA.id, false)).toEqual({ status: 'network' });
    expect(await fake.service.invite(invite())).toEqual({ status: 'network' });
    expect(await fake.service.resendInvite(DARIO.id)).toEqual({ status: 'network' });
    expect(await fake.service.cancelInvite(DARIO.id)).toEqual({ status: 'network' });
    fake.setNetworkDown(false);
    expect(await namesAndStatuses(fake)).toContain('carla Prova: active');
    expect(await namesAndStatuses(fake)).toContain('Dario Prova: invited');
    expect(fake.emails).toEqual([]);
  });

  it('a lost answer applies the change and resolves network', async () => {
    const fake = setUp();
    fake.failNext('setActive', 'lost');
    expect(await fake.service.setActive(CARLA.id, false)).toEqual({ status: 'network' });
    expect(await namesAndStatuses(fake)).toContain('carla Prova: deactivated');
  });

  it('an Error rejects as it is, without changing anything', async () => {
    const fake = setUp();
    fake.failNext('setRole', new ServerFaultError('misconfigured'));
    await expect(fake.service.setRole(CARLA.id, 'admin')).rejects.toBeInstanceOf(ServerFaultError);
    const result = await fake.service.list();
    expect(result.status === 'ok' && result.operators.find((o) => o.id === CARLA.id)?.role).toBe(
      'operator',
    );
  });

  it('holdNext delays the answer until released', async () => {
    const fake = setUp();
    const hold = fake.holdNext('list');
    let settled = false;
    const pending = fake.service.list().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    hold.release();
    await pending;
    expect(settled).toBe(true);
  });

  it('logs every call with its arguments, and the vi.fn mocks too', async () => {
    const fake = setUp();
    const input = invite();
    await fake.service.list();
    await fake.service.setRole(CARLA.id, 'admin');
    await fake.service.invite(input);
    expect(fake.calls).toEqual([
      { method: 'list', args: [] },
      { method: 'setRole', args: [CARLA.id, 'admin'] },
      { method: 'invite', args: [input] },
    ]);
    expect(fake.service.invite).toHaveBeenCalledWith(input);
  });
});
