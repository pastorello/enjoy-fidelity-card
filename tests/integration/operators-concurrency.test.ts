import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdOpenAs, localSupabase, memoryClient, runSql, waitForBlocked } from './localSupabase';

// SPEC-operators.md, "Testing Strategy", row "Concorrenza": the races of the Operatori screen
// on two connections. Criterion 8: two admins demoting or deactivating each other never leave
// the bar without an admin. Criterion 7: a deactivation racing unlock_cashier of the same person never
// deadlocks and never leaves a working till turn. Point 5: two invites to the same email never
// reach Auth together. Point 7 and Open Questions 11: the PIN asked again for an admin action
// from the tablet is the PIN of the admin whose rights were checked, even when the till changes
// hands in between. Every account is made here and removed at the end, so the seed accounts
// reserved to the E2E are never touched.
const local = localSupabase();
const secret = memoryClient(local.url, local.secretKey);

const run = randomUUID().slice(0, 8);
type Account = { email: string; name: string; password: string; userId: string; id: string };

function account(label: string, name: string): Account {
  return {
    email: `${label}-${run}@example.com`,
    name: `${name} ${run}`,
    password: randomBytes(18).toString('base64url'),
    userId: '',
    id: '',
  };
}

const adminA = account('corsa-admin-a', 'Corsa Admin A');
const adminB = account('corsa-admin-b', 'Corsa Admin B');
/** Invites and deactivates; never part of the race between A and B. */
const adminC = account('corsa-admin-c', 'Corsa Admin C');
const cashier = account('corsa-cassiere', 'Corsa Cassiere');
/** An operator that the admin actions from the tablet try to promote. */
const promotee = account('corsa-bersaglio', 'Corsa Bersaglio');
const device = account('corsa-tablet', 'Corsa Tablet');
const operators = [adminA, adminB, adminC, cashier, promotee];
// A fake PIN.
const PIN = '5937';
// A fake PIN of adminA, the admin at the till.
const ADMIN_PIN = '8264';
// A race is microseconds wide: several rounds, each from the same starting state.
const ROUNDS = 10;
// How long a transaction held open in psql keeps the API call queued behind it.
const HOLD_SECONDS = 1;

const clients = new Map<Account, SupabaseClient>();
function client(of: Account): SupabaseClient {
  const signed = clients.get(of);
  if (!signed) throw new Error(`${of.name} is not signed in`);
  return signed;
}

async function createUser(of: Account): Promise<void> {
  const { data, error } = await secret.auth.admin.createUser({
    email: of.email,
    password: of.password,
    email_confirm: true,
  });
  if (error) throw error;
  of.userId = data.user.id;
}

async function signIn(of: Account): Promise<void> {
  const signed = memoryClient(local.url, local.publishableKey);
  const { error } = await signed.auth.signInWithPassword({
    email: of.email,
    password: of.password,
  });
  if (error) throw error;
  clients.set(of, signed);
}

/** The Postgres code of a refused call, or 'ok'. */
type Outcome = { code: string; data: unknown };

async function rpc(of: Account, fn: string, args: Record<string, unknown>): Promise<Outcome> {
  const { data, error } = await client(of).schema('app').rpc(fn, args);
  return { code: error ? error.code : 'ok', data: data as unknown };
}

const demote = (by: Account, target: Account) =>
  rpc(by, 'set_operator_role', { p_operator_id: target.id, p_role: 'operator' });
const deactivateBy = (by: Account, target: Account) =>
  rpc(by, 'set_operator_active', { p_operator_id: target.id, p_active: false });
const deactivate = (target: Account) => deactivateBy(adminC, target);
const unlock = () => rpc(device, 'unlock_cashier', { p_operator_id: cashier.id, p_pin: PIN });

function statusOf(outcome: Outcome): string {
  const { data } = outcome;
  if (outcome.code !== 'ok') return `error ${outcome.code}`;
  return typeof data === 'object' && data !== null && 'status' in data
    ? String(data.status)
    : JSON.stringify(data);
}

/** Runs `round` ROUNDS times, one after the other, so every round is a fresh race. */
async function rounds(round: (index: number) => Promise<void>, index = 0): Promise<void> {
  if (index === ROUNDS) return;
  await round(index);
  await rounds(round, index + 1);
}

/**
 * How many of A and B are still active admins. Only the two racing: adminC and the seed admins
 * would keep any count of the whole bar at one or more whatever the race did.
 */
function activeAdminsOfAB(): number {
  return Number(
    runSql(
      `select count(*) from app.operators
       where id in (:'a'::uuid, :'b'::uuid) and role = 'admin' and deactivated_at is null;`,
      { a: adminA.id, b: adminB.id },
    ),
  );
}

function roleOf(of: Account): string {
  return runSql(`select role from app.operators where id = :'id'::uuid;`, { id: of.id });
}

/** 'admin' / 'operator', with ' off' when deactivated. */
function stateOf(of: Account): string {
  return runSql(
    `select role || case when deactivated_at is null then '' else ' off' end
     from app.operators where id = :'id'::uuid;`,
    { id: of.id },
  );
}

/** A and B active admins again. */
function restoreAdmins(): void {
  runSql(
    `update app.operators set role = 'admin', deactivated_at = null, deactivated_by = null
     where id in (:'a'::uuid, :'b'::uuid);`,
    { a: adminA.id, b: adminB.id },
  );
}

/** The cashier active again and the tablet without a turn nor a lock. */
function restoreCashier(): void {
  runSql(
    `update app.operators set deactivated_at = null, deactivated_by = null where id = :'id'::uuid;
     update app.devices set cashier_operator_id = null, cashier_since = null,
       failed_pin_attempts = 0, locked_until = null
     where user_id = :'device'::uuid;`,
    { id: cashier.id, device: device.userId },
  );
}

/** Every table and view of app, read from the catalog so a new one is covered too. */
function appRelations(): string[] {
  return runSql(
    `select c.relname from pg_class c
     where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
     order by c.relname;`,
  ).split('\n');
}

/** What the tablet reads from each relation: a row count, or the refusal. */
async function deviceReads(): Promise<string[]> {
  return Promise.all(
    appRelations().map(async (name) => {
      const { data, error } = await client(device).schema('app').from(name).select('*');
      return error ? `${name}: refused` : `${name}: ${data.length}`;
    }),
  );
}

/** After the race the tablet gives nothing: no cashier, no row from any relation. */
async function expectTabletGivesNothing(): Promise<void> {
  const identity = await rpc(device, 'get_session_identity', {});
  expect(identity.code).toBe('ok');
  expect(identity.data).toMatchObject({ kind: 'device', cashier: null });
  const reads = await deviceReads();
  expect(reads.filter((line) => !/: (0|refused)$/.test(line))).toEqual([]);
}

/** What a round left: the answers, the roles of A and B, whether one of them is still an admin. */
function demotionRace(outcomes: Outcome[]) {
  return {
    codes: outcomes.map((outcome) => outcome.code).toSorted(),
    roles: [roleOf(adminA), roleOf(adminB)].toSorted(),
    adminLeft: activeAdminsOfAB() >= 1,
  };
}

/** The same for races that deactivate: the state (role, deactivated) of A and B. */
function accessRace(outcomes: Outcome[]) {
  return {
    codes: outcomes.map((outcome) => outcome.code).toSorted(),
    states: [stateOf(adminA), stateOf(adminB)].toSorted(),
    adminLeft: activeAdminsOfAB() >= 1,
  };
}

const invite = (by: Account, operationId: string, name: string, email: string) =>
  rpc(by, 'operator_invite_begin', {
    p_operation_id: operationId,
    p_name: name,
    p_email: email,
    p_role: 'operator',
  });

function pendingFor(email: string): number {
  return Number(
    runSql(
      `select count(*) from private.operator_invites
       where lower(email) = :'email' and status = 'pending';`,
      { email },
    ),
  );
}

beforeAll(async () => {
  await Promise.all([...operators, device].map(createUser));
  for (const [of, role] of [
    [adminA, 'admin'],
    [adminB, 'admin'],
    [adminC, 'admin'],
    [cashier, 'operator'],
    [promotee, 'operator'],
  ] as const) {
    of.id = runSql(`select private.add_operator(:'email', :'name', :'role');`, {
      email: of.email,
      name: of.name,
      role,
    });
  }
  device.id = runSql(`select private.add_device(:'email', :'name');`, {
    email: device.email,
    name: device.name,
  });
  await Promise.all([...operators, device].map(signIn));
  const pin = await rpc(cashier, 'set_my_pin', { p_pin: PIN });
  if (pin.code !== 'ok') throw new Error(`set_my_pin answered ${pin.code}`);
  const adminPin = await rpc(adminA, 'set_my_pin', { p_pin: ADMIN_PIN });
  if (adminPin.code !== 'ok') throw new Error(`set_my_pin answered ${adminPin.code}`);
});

afterAll(async () => {
  // Reservations, devices and profiles outlive their Auth users by design: remove them so the
  // other suites see the seed only. Reservations and deactivated_by point at the profiles.
  const ids = operators.map((of) => of.id).filter(Boolean);
  runSql(
    `delete from private.operator_invites where requested_by = any(string_to_array(:'ids', ',')::uuid[]);
     delete from app.devices where name = :'device';
     update app.operators set deactivated_at = null, deactivated_by = null
     where id = any(string_to_array(:'ids', ',')::uuid[]);
     delete from private.operator_pins where operator_id = any(string_to_array(:'ids', ',')::uuid[]);
     delete from app.operators where id = any(string_to_array(:'ids', ',')::uuid[]);`,
    { ids: ids.join(','), device: device.name },
  );
  await Promise.all(
    [...operators, device]
      .map((of) => of.userId)
      .filter(Boolean)
      .map((id) => secret.auth.admin.deleteUser(id).catch(() => undefined)),
  );
});

describe('A demotes B while B demotes A (criterion 8)', () => {
  /** One demotion went through, the other was refused with 42501; A or B is still an admin. */
  const ONE_DEMOTION = { codes: ['42501', 'ok'], roles: ['admin', 'operator'], adminLeft: true };

  it(`at once, ${ROUNDS} rounds: one wins, the other is no admin any more`, async () => {
    const races: ReturnType<typeof demotionRace>[] = [];
    await rounds(async () => {
      restoreAdmins();
      races.push(demotionRace(await Promise.all([demote(adminA, adminB), demote(adminB, adminA)])));
    });
    expect(races).toEqual(Array.from({ length: ROUNDS }, () => ONE_DEMOTION));
  });

  it('both queued behind a lock on A: the second one sees the first and gets 42501', async () => {
    restoreAdmins();
    const { released } = await holdOpenAs(
      adminC.userId,
      `select 1 from app.operators where id = :'id'::uuid for update`,
      { id: adminA.id },
      HOLD_SECONDS,
    );
    const calls = Promise.all([demote(adminA, adminB), demote(adminB, adminA)]);
    await waitForBlocked(2);
    await released;
    expect(demotionRace(await calls)).toEqual(ONE_DEMOTION);
  });

  afterAll(restoreAdmins);
});

describe('A deactivates B while B deactivates A (criterion 8)', () => {
  /** One deactivation went through, the other was refused with 42501; A or B is still an admin. */
  const ONE_DEACTIVATION = {
    codes: ['42501', 'ok'],
    states: ['admin', 'admin off'],
    adminLeft: true,
  };

  it(`at once, ${ROUNDS} rounds: one wins, the other has no access any more`, async () => {
    const races: ReturnType<typeof accessRace>[] = [];
    await rounds(async () => {
      restoreAdmins();
      races.push(
        accessRace(await Promise.all([deactivateBy(adminA, adminB), deactivateBy(adminB, adminA)])),
      );
    });
    expect(races).toEqual(Array.from({ length: ROUNDS }, () => ONE_DEACTIVATION));
  });

  it('both queued behind a lock on A: the second one sees the first and gets 42501', async () => {
    restoreAdmins();
    const { released } = await holdOpenAs(
      adminC.userId,
      `select 1 from app.operators where id = :'id'::uuid for update`,
      { id: adminA.id },
      HOLD_SECONDS,
    );
    const calls = Promise.all([deactivateBy(adminA, adminB), deactivateBy(adminB, adminA)]);
    await waitForBlocked(2);
    await released;
    expect(accessRace(await calls)).toEqual(ONE_DEACTIVATION);
  });

  it(`A demotes B while B deactivates A, ${ROUNDS} rounds: one wins, A or B stays an admin`, async () => {
    const races: ReturnType<typeof accessRace>[] = [];
    await rounds(async () => {
      restoreAdmins();
      races.push(
        accessRace(await Promise.all([demote(adminA, adminB), deactivateBy(adminB, adminA)])),
      );
    });
    // A won: B is an operator, A an admin. B won: A is deactivated, B an admin.
    for (const race of races) {
      expect(race.codes).toEqual(['42501', 'ok']);
      expect([
        ['admin', 'operator'],
        ['admin', 'admin off'],
      ]).toContainEqual(race.states);
      expect(race.adminLeft).toBe(true);
    }
  });

  afterAll(restoreAdmins);
});

describe('a deactivation racing unlock_cashier of the same person (criterion 7)', () => {
  afterAll(restoreCashier);

  // Neither call may fail: a deadlock would be 40P01.
  it(`at once from a closed turn, ${ROUNDS} rounds: no deadlock, the tablet gives nothing`, async () => {
    await rounds(async () => {
      restoreCashier();
      const [unlocked, deactivated] = await Promise.all([unlock(), deactivate(cashier)]);
      expect(deactivated.code).toBe('ok');
      expect(['ok', 'no_pin']).toContain(statusOf(unlocked));
      await expectTabletGivesNothing();
    });
  });

  it(`at once with the person already the cashier, ${ROUNDS} rounds: no deadlock`, async () => {
    await rounds(async () => {
      restoreCashier();
      expect(statusOf(await unlock())).toBe('ok');
      const [unlocked, deactivated] = await Promise.all([unlock(), deactivate(cashier)]);
      expect(deactivated.code).toBe('ok');
      expect(['ok', 'no_pin']).toContain(statusOf(unlocked));
      await expectTabletGivesNothing();
    });
  });

  // The foreign key app.devices.cashier_operator_id: an unlock that changes the cashier takes a
  // FOR KEY SHARE on the operator row when it writes the device. So which one waits depends on
  // which lock comes first; neither order is a cycle, and the next two tests force each one.
  it('the unlock wrote the new turn first: the deactivation queues behind it, then closes it', async () => {
    restoreCashier();
    const { released } = await holdOpenAs(
      device.userId,
      `select app.unlock_cashier(:'operator'::uuid, :'pin')`,
      { operator: cashier.id, pin: PIN },
      HOLD_SECONDS,
    );
    const deactivated = deactivate(cashier);
    await waitForBlocked(1);
    expect(await released).toContain('"status": "ok"');
    expect((await deactivated).code).toBe('ok');
    await expectTabletGivesNothing();
  });

  it('the unlock read the person before the deactivation and writes after it: a dead turn', async () => {
    restoreCashier();
    // The unlock reads the operator, then waits on the PIN row (for share) held here.
    const { released } = await holdOpenAs(
      adminC.userId,
      `select 1 from private.operator_pins where operator_id = :'operator'::uuid for update`,
      { operator: cashier.id },
      HOLD_SECONDS,
    );
    const unlocked = unlock();
    await waitForBlocked(1);
    // The committed device row has no turn of this person: the deactivation does not wait.
    expect((await deactivate(cashier)).code).toBe('ok');
    await released;
    expect(statusOf(await unlocked)).toBe('ok');
    // Only to prove this test reached the race of point 7: the turn is written, with a
    // deactivated cashier. The guarantee is valid_cashier_id, checked below.
    expect(
      runSql(`select cashier_operator_id from app.devices where user_id = :'device'::uuid;`, {
        device: device.userId,
      }),
    ).toBe(cashier.id);
    await expectTabletGivesNothing();
  });

  it('already the cashier, the unlock holds the tablet: the deactivation queues, no deadlock', async () => {
    restoreCashier();
    expect(statusOf(await unlock())).toBe('ok');
    const { released } = await holdOpenAs(
      device.userId,
      `select app.unlock_cashier(:'operator'::uuid, :'pin')`,
      { operator: cashier.id, pin: PIN },
      HOLD_SECONDS,
    );
    const deactivated = deactivate(cashier);
    await waitForBlocked(1);
    await released;
    expect((await deactivated).code).toBe('ok');
    await expectTabletGivesNothing();
  });

  it('already the cashier, the deactivation holds both rows: the unlock queues, then no_pin', async () => {
    restoreCashier();
    expect(statusOf(await unlock())).toBe('ok');
    const { released } = await holdOpenAs(
      adminC.userId,
      `select 1 from app.set_operator_active(:'operator'::uuid, false)`,
      { operator: cashier.id },
      HOLD_SECONDS,
    );
    const unlocked = unlock();
    await waitForBlocked(1);
    await released;
    expect(statusOf(await unlocked)).toBe('no_pin');
    await expectTabletGivesNothing();
  });
});

describe('two invites to the same email with different operation_ids (point 5)', () => {
  it(`two admins at once, ${ROUNDS} rounds: one proceed, the other in_progress`, async () => {
    await rounds(async (index) => {
      const email = `invito-corsa-${index}-${run}@example.com`;
      const outcomes = await Promise.all([
        invite(adminA, randomUUID(), `Invito Corsa ${index} Uno ${run}`, email),
        invite(adminC, randomUUID(), `Invito Corsa ${index} Due ${run}`, email),
      ]);
      expect(outcomes.map(statusOf).toSorted()).toEqual(['in_progress', 'proceed']);
      expect(pendingFor(email)).toBe(1);
    });
  });

  it('queued behind an open reservation: the second waits for it, then in_progress', async () => {
    const email = `invito-coda-${run}@example.com`;
    const { released } = await holdOpenAs(
      adminC.userId,
      `select app.operator_invite_begin(:'op'::uuid, :'name', :'email', 'operator')`,
      { op: randomUUID(), name: `Invito Coda Uno ${run}`, email },
      HOLD_SECONDS,
    );
    const second = invite(adminA, randomUUID(), `Invito Coda Due ${run}`, email);
    await waitForBlocked(1);
    expect(await released).toContain('"status": "proceed"');
    expect(statusOf(await second)).toBe('in_progress');
    expect(pendingFor(email)).toBe(1);
  });

  it('the same name on two emails at once: one proceed, the other in_progress', async () => {
    const name = `Invito Stesso Nome ${run}`;
    const outcomes = await Promise.all([
      invite(adminA, randomUUID(), name, `invito-nome-uno-${run}@example.com`),
      invite(adminC, randomUUID(), name, `invito-nome-due-${run}@example.com`),
    ]);
    expect(outcomes.map(statusOf).toSorted()).toEqual(['in_progress', 'proceed']);
  });
});

/** adminA at the till, no wrong PIN counted, the target an operator again. */
function adminAtTheTill(): void {
  runSql(
    `update app.devices set cashier_operator_id = :'admin'::uuid, cashier_since = now(),
       failed_pin_attempts = 0, locked_until = null
     where user_id = :'device'::uuid;
     update app.operators set role = 'operator' where id = :'target'::uuid;`,
    { admin: adminA.id, device: device.userId, target: promotee.id },
  );
}

/**
 * The till handed to the operator `cashier` and not committed yet, as unlock_cashier does once
 * the PIN is right: the admin action checks its rights with adminA, then queues on the device.
 */
const handTillToOperator = () =>
  holdOpenAs(
    device.userId,
    `update app.devices set cashier_operator_id = :'cashier'::uuid, cashier_since = now()
     where user_id = :'device'::uuid`,
    { cashier: cashier.id, device: device.userId },
    HOLD_SECONDS,
  );

function pinCounter(): string {
  return runSql(
    `select failed_pin_attempts || '|' || (locked_until is not null) from app.devices
     where user_id = :'device'::uuid;`,
    { device: device.userId },
  );
}

describe('the till changes hands during an admin action with the PIN (point 7, Open Questions 11)', () => {
  afterAll(() => {
    adminAtTheTill();
    restoreCashier();
  });

  it('naming an admin: the PIN of the operator who took the till authorises nothing', async () => {
    adminAtTheTill();
    const { released } = await handTillToOperator();
    const promoted = rpc(device, 'set_operator_role_with_pin', {
      p_operator_id: promotee.id,
      p_role: 'admin',
      p_pin: PIN,
    });
    await waitForBlocked(1);
    await released;
    expect((await promoted).code).toBe('42501');
    expect(roleOf(promotee)).toBe('operator');
    expect(pinCounter()).toBe('0|false');
  });

  it('inviting an admin: refused the same way, and nothing reserved', async () => {
    adminAtTheTill();
    const email = `invito-cassa-cambiata-${run}@example.com`;
    const { released } = await handTillToOperator();
    const invited = rpc(device, 'operator_invite_begin', {
      p_operation_id: randomUUID(),
      p_name: `Invito Cassa Cambiata ${run}`,
      p_email: email,
      p_role: 'admin',
      p_pin: PIN,
    });
    await waitForBlocked(1);
    await released;
    expect((await invited).code).toBe('42501');
    expect(pendingFor(email)).toBe(0);
    expect(pinCounter()).toBe('0|false');
  });

  it('the same admin still at the till: the PIN asked again names the admin', async () => {
    adminAtTheTill();
    const promoted = await rpc(device, 'set_operator_role_with_pin', {
      p_operator_id: promotee.id,
      p_role: 'admin',
      p_pin: ADMIN_PIN,
    });
    expect(statusOf(promoted)).toBe('ok');
    expect(roleOf(promotee)).toBe('admin');
  });
});
