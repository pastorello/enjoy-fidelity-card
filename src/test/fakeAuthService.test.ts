import { describe, expect, it } from 'vitest';
import { createFakeAuthService, fakeOperator } from './fakeAuthService';
import type { Operator } from '../features/identity/types';

const linkOperator: Operator = { id: 'op-2', name: 'Marco Prova', role: 'operator' };

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
    expect(await fake.service.loadOperator('user-1')).toEqual(fakeOperator);

    await fake.service.verifyRecovery('hash');

    expect(seen).toEqual(['user-2']);
    await expect(fake.service.currentUserId()).resolves.toBe('user-2');
    await expect(fake.service.currentEmail()).resolves.toBe('marco@example.com');
    await expect(fake.service.loadOperator('user-2')).resolves.toEqual(linkOperator);
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
