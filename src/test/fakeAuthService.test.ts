import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeAuthService, fakeDevice, fakeOperator } from './fakeAuthService';
import { createFakeKioskService } from './fakeKioskService';
import type { Operator } from '../features/identity/types';

const linkOperator: Operator = { id: 'op-2', name: 'Marco Prova', role: 'operator' };
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

describe('createFakeAuthService: session identity', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('an operator account by default, without a PIN until set', async () => {
    const fake = createFakeAuthService({ userId: 'user-1' });
    await expect(fake.service.loadIdentity()).resolves.toEqual({
      kind: 'operator',
      operator: fakeOperator,
      hasPin: false,
    });
    fake.setHasPin(true);
    await expect(fake.service.loadIdentity()).resolves.toEqual({
      kind: 'operator',
      operator: fakeOperator,
      hasPin: true,
    });
  });

  it('an operator whose PIN follows a source, such as the kiosk fake', async () => {
    const kiosk = createFakeKioskService({
      account: { kind: 'operator', operatorId: 'op-9' },
      cashiers: [{ id: 'op-9', name: 'Marco Prova', role: 'operator', pin: null }],
    });
    const fake = createFakeAuthService({ userId: 'user-1', hasPin: () => kiosk.hasPin('op-9') });
    await expect(fake.service.loadIdentity()).resolves.toMatchObject({ hasPin: false });
    await kiosk.service.setMyPin('2468');
    await expect(fake.service.loadIdentity()).resolves.toMatchObject({ hasPin: true });
  });

  it('no profile: null, as for a removed account', async () => {
    const fake = createFakeAuthService({ userId: 'user-1', operator: null });
    await expect(fake.service.loadIdentity()).resolves.toBeNull();
    fake.setProfile(linkOperator);
    fake.removeProfile();
    await expect(fake.service.loadIdentity()).resolves.toBeNull();
  });

  it('a device without a cashier', async () => {
    const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice });
    await expect(fake.service.loadIdentity()).resolves.toEqual({
      kind: 'device',
      device: fakeDevice,
      cashier: null,
      turnExpiresAt: null,
      lockSecondsLeft: 0,
    });
  });

  it('a device with a cashier: a 12-hour turn by default, the lock as set', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-18T10:00:00Z') });
    const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice });
    fake.setCashier(linkOperator);
    fake.setLock(42);
    await expect(fake.service.loadIdentity()).resolves.toEqual({
      kind: 'device',
      device: fakeDevice,
      cashier: linkOperator,
      turnExpiresAt: new Date('2026-11-18T22:00:00Z'),
      lockSecondsLeft: 42,
    });
  });

  it('an expired turn has no cashier, whether by the clock or by hand', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-18T10:00:00Z') });
    const fake = createFakeAuthService({
      userId: 'user-1',
      device: fakeDevice,
      cashier: linkOperator,
    });
    await expect(fake.service.loadIdentity()).resolves.toMatchObject({ cashier: linkOperator });

    vi.advanceTimersByTime(TWELVE_HOURS);
    await expect(fake.service.loadIdentity()).resolves.toMatchObject({
      kind: 'device',
      cashier: null,
      turnExpiresAt: null,
    });

    fake.setCashier(linkOperator);
    fake.expireTurn();
    await expect(fake.service.loadIdentity()).resolves.toMatchObject({
      cashier: null,
      turnExpiresAt: null,
    });
  });

  it('a device can follow the fake kiosk, as the server shares one cashier', async () => {
    const kiosk = createFakeKioskService();
    const fake = createFakeAuthService({ userId: 'user-1' });
    fake.setDevice(fakeDevice, () => kiosk.device());
    await expect(fake.service.loadIdentity()).resolves.toMatchObject({ cashier: null });

    const [giulia] = await kiosk.service.listCashiers();
    if (!giulia) throw new Error('precondition: the fake kiosk has cashiers');
    const unlocked = await kiosk.service.unlock(giulia.id, '1234');
    if (unlocked.status !== 'ok') throw new Error('precondition: the unlock succeeds');
    await expect(fake.service.loadIdentity()).resolves.toEqual({
      kind: 'device',
      device: fakeDevice,
      cashier: unlocked.cashier,
      turnExpiresAt: unlocked.turnExpiresAt,
      lockSecondsLeft: 0,
    });

    kiosk.expireTurn();
    await expect(fake.service.loadIdentity()).resolves.toMatchObject({ cashier: null });
  });

  it('switching to an operator account leaves the device', async () => {
    const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice });
    fake.switchUser('user-2', linkOperator);
    await expect(fake.service.loadIdentity()).resolves.toMatchObject({
      kind: 'operator',
      operator: linkOperator,
    });
  });
});

describe('createFakeAuthService: password recovery', () => {
  it('answers "sent" and "ok" by default and counts every call', async () => {
    const { service } = createFakeAuthService();
    await expect(service.requestPasswordReset('a@example.com', 'http://x')).resolves.toBe('sent');
    await expect(service.requestPasswordReset('a@example.com', 'http://x')).resolves.toBe('sent');
    await expect(service.verifyRecovery('hash')).resolves.toBe('ok');
    await expect(service.updatePassword('nuova-password')).resolves.toBe('ok');
    await expect(service.signOutOtherDevices()).resolves.toBeUndefined();
    expect(service.requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(service.verifyRecovery).toHaveBeenCalledTimes(1);
    expect(service.updatePassword).toHaveBeenCalledTimes(1);
    expect(service.signOutOtherDevices).toHaveBeenCalledTimes(1);
  });

  it('plays programmed results in order, then repeats the last one', async () => {
    const { service } = createFakeAuthService({
      resetResults: ['network', 'sent'],
      verifyResults: ['network', 'invalid-link'],
      updatePasswordResults: ['network', 'same-password'],
    });
    expect(await service.requestPasswordReset('a@example.com', 'http://x')).toBe('network');
    expect(await service.requestPasswordReset('a@example.com', 'http://x')).toBe('sent');
    expect(await service.requestPasswordReset('a@example.com', 'http://x')).toBe('sent');
    expect(await service.verifyRecovery('hash')).toBe('network');
    expect(await service.verifyRecovery('hash')).toBe('invalid-link');
    expect(await service.verifyRecovery('hash')).toBe('invalid-link');
    expect(await service.updatePassword('p')).toBe('network');
    expect(await service.updatePassword('p')).toBe('same-password');
  });

  it('reads the email of the saved session only while signed in', async () => {
    const signedIn = createFakeAuthService({ userId: 'user-1', email: 'giulia@example.com' });
    await expect(signedIn.service.currentEmail()).resolves.toBe('giulia@example.com');
    const signedOut = createFakeAuthService({ email: 'giulia@example.com' });
    await expect(signedOut.service.currentEmail()).resolves.toBeNull();
  });

  it('a successful verification replaces the session with the link user, like verifyOtp', async () => {
    const fake = createFakeAuthService({
      userId: 'user-1',
      recoveryUser: { userId: 'user-2', operator: linkOperator, email: 'marco@example.com' },
    });
    const seen: (string | null)[] = [];
    fake.service.onAuthChange((id) => seen.push(id));
    expect(await fake.service.loadIdentity()).toMatchObject({ operator: fakeOperator });

    await fake.service.verifyRecovery('hash');

    expect(seen).toEqual(['user-2']);
    await expect(fake.service.currentUserId()).resolves.toBe('user-2');
    await expect(fake.service.currentEmail()).resolves.toBe('marco@example.com');
    await expect(fake.service.loadIdentity()).resolves.toMatchObject({ operator: linkOperator });
  });

  it('a failed verification leaves the session as it was', async () => {
    const fake = createFakeAuthService({ userId: 'user-1', verifyResults: ['invalid-link'] });
    const seen: (string | null)[] = [];
    fake.service.onAuthChange((id) => seen.push(id));
    await fake.service.verifyRecovery('hash');
    expect(seen).toEqual([]);
    await expect(fake.service.currentUserId()).resolves.toBe('user-1');
  });
});
