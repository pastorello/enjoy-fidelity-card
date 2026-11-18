import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Component, useEffect } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeAuthService, fakeDevice, fakeOperator } from '../../test/fakeAuthService';
import type { Operator, SessionIdentity } from './types';
import { AuthProvider, useAuth, useCurrentOperator, useDevice } from './AuthProvider';

function Probe() {
  const auth = useAuth();
  const text =
    auth.state.status === 'signed-in'
      ? `in:${auth.state.operator.name}`
      : auth.state.status === 'signed-out'
        ? `out:${auth.state.reason ?? '-'}`
        : auth.state.status;
  return <p data-testid="state">{text}</p>;
}

/** The role seen by screens behind <RequireAuth>, or '-' when nobody is signed in. */
function RoleProbe() {
  const { state } = useAuth();
  return <p data-testid="role">{state.status === 'signed-in' ? <Role /> : '-'}</p>;
}

function Role() {
  return <>{useCurrentOperator().role}</>;
}

function renderWith(fake: ReturnType<typeof createFakeAuthService>) {
  const captured: { auth?: ReturnType<typeof useAuth> } = {};
  function Capture() {
    const auth = useAuth();
    useEffect(() => {
      captured.auth = auth;
    });
    return null;
  }
  render(
    <AuthProvider service={fake.service}>
      <Probe />
      <RoleProbe />
      <Capture />
    </AuthProvider>,
  );
  return () => {
    if (!captured.auth) throw new Error('useAuth not rendered');
    return captured.auth;
  };
}

const state = () => screen.getByTestId('state');
const role = () => screen.getByTestId('role');

async function complete(
  auth: () => ReturnType<typeof useAuth>,
  tokenHash = 'token-abc',
  password = 'nuova-password',
) {
  let outcome: string | undefined;
  await act(async () => {
    outcome = await auth().completeRecovery(tokenHash, password);
  });
  return outcome;
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

/** What a device session shows: device, cashier (as the current operator) and lock. */
function DeviceProbe() {
  const device = useDevice();
  if (!device) return <p data-testid="device">-</p>;
  return (
    <p data-testid="device">
      {device.device.name}|{device.cashier ? <CurrentOperator /> : 'nessuno'}|
      {device.turnExpiresAt?.toISOString() ?? '-'}|{device.lockSecondsLeft}
    </p>
  );
}

function CurrentOperator() {
  const operator = useCurrentOperator();
  return (
    <>
      {operator.name}:{operator.role}
    </>
  );
}

function renderDevice(fake: ReturnType<typeof createFakeAuthService>) {
  const captured: { auth?: ReturnType<typeof useAuth> } = {};
  function Capture() {
    const auth = useAuth();
    useEffect(() => {
      captured.auth = auth;
    });
    return null;
  }
  render(
    <AuthProvider service={fake.service}>
      <Probe />
      <DeviceProbe />
      <Capture />
    </AuthProvider>,
  );
  return () => {
    if (!captured.auth) throw new Error('useAuth not rendered');
    return captured.auth;
  };
}

const device = () => screen.getByTestId('device');

/** Renders "refused" when its child throws, as an error boundary does. */
class Refused extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <p data-testid="current">refused</p> : this.props.children;
  }
}

function Current() {
  return <p data-testid="current">{useCurrentOperator().name}</p>;
}

describe('AuthProvider', () => {
  it('starts loading, then signed out when no session is saved', async () => {
    renderWith(createFakeAuthService());
    expect(state()).toHaveTextContent('loading');
    await waitFor(() => expect(state()).toHaveTextContent('out:-'));
  });

  it('restores a saved session with its operator profile', async () => {
    const fake = createFakeAuthService({ userId: 'user-1' });
    renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent(`in:${fakeOperator.name}`));
    expect(fake.service.loadIdentity).toHaveBeenCalledOnce();
  });

  it('ends a saved session whose user has no profile', async () => {
    const fake = createFakeAuthService({ userId: 'user-1', operator: null });
    renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent('out:not-enabled'));
    expect(fake.service.signOut).toHaveBeenCalledOnce();
  });

  it('shows an error state when the profile cannot be loaded, and retries', async () => {
    const fake = createFakeAuthService({ userId: 'user-1' });
    fake.service.loadIdentity.mockRejectedValueOnce(new Error('offline'));
    const auth = renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent('error'));
    await act(() => auth().retry());
    expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
  });

  it('shows an error state, not signed out, when the saved session cannot be refreshed offline', async () => {
    const fake = createFakeAuthService({ userId: 'user-1' });
    fake.service.currentUserId.mockRejectedValueOnce(new Error('offline'));
    const auth = renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent('error'));
    await act(() => auth().retry());
    expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
  });

  it('signs in and loads the operator', async () => {
    const fake = createFakeAuthService();
    const auth = renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent('out:-'));
    let result: string | undefined;
    await act(async () => {
      result = await auth().signIn('giulia@example.com', 'password-di-prova');
    });
    expect(result).toBe('ok');
    expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
  });

  it('ends the new session and reports a network failure when the profile cannot be loaded', async () => {
    const fake = createFakeAuthService();
    fake.service.loadIdentity.mockRejectedValueOnce(new Error('offline'));
    const auth = renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent('out:-'));
    let result: string | undefined;
    await act(async () => {
      result = await auth().signIn('giulia@example.com', 'password-di-prova');
    });
    expect(result).toBe('network');
    expect(fake.service.signOut).toHaveBeenCalledOnce();
    expect(state()).toHaveTextContent('out:-');
  });

  it.each(['misconfigured', 'unavailable'] as const)(
    'reports a %s server, not a network failure, when the profile cannot be loaded',
    async (kind) => {
      const fake = createFakeAuthService();
      fake.service.loadIdentity.mockRejectedValueOnce(new ServerFaultError(kind));
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      let result: string | undefined;
      await act(async () => {
        result = await auth().signIn('giulia@example.com', 'password-di-prova');
      });
      expect(result).toBe(kind);
      expect(fake.service.signOut).toHaveBeenCalledOnce();
      expect(state()).toHaveTextContent('out:-');
    },
  );

  it('reports wrong credentials and stays signed out', async () => {
    const fake = createFakeAuthService({ signInResult: 'invalid' });
    const auth = renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent('out:-'));
    let result: string | undefined;
    await act(async () => {
      result = await auth().signIn('giulia@example.com', 'sbagliata');
    });
    expect(result).toBe('invalid');
    expect(state()).toHaveTextContent('out:-');
  });

  it('refuses a sign-in whose user has no profile, and ends that session', async () => {
    const fake = createFakeAuthService({ operator: null });
    const auth = renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent('out:-'));
    let result: string | undefined;
    await act(async () => {
      result = await auth().signIn('nuovo@example.com', 'password-di-prova');
    });
    expect(result).toBe('not-enabled');
    expect(fake.service.signOut).toHaveBeenCalledOnce();
    expect(state()).toHaveTextContent('out:-');
  });

  it('signs out without a reason when the user asks', async () => {
    const fake = createFakeAuthService({ userId: 'user-1' });
    const auth = renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent('in:'));
    await act(() => auth().signOut());
    expect(state()).toHaveTextContent('out:-');
  });

  it('marks the session expired when it ends on its own', async () => {
    const fake = createFakeAuthService({ userId: 'user-1' });
    renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent('in:'));
    act(() => fake.endSession());
    expect(state()).toHaveTextContent('out:expired');
  });

  it('checks the profile again when the saved session switches to another user', async () => {
    const fake = createFakeAuthService({ userId: 'user-1' });
    renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent(`in:${fakeOperator.name}`));
    const other: Operator = { id: 'op-2', name: 'Marco Prova', role: 'operator' };
    act(() => fake.switchUser('user-2', other));
    await waitFor(() => expect(state()).toHaveTextContent('in:Marco Prova'));
    expect(fake.service.loadIdentity).toHaveBeenCalledTimes(2);
  });

  it('ends a switched session whose user has no profile', async () => {
    const fake = createFakeAuthService({ userId: 'user-1' });
    renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent(`in:${fakeOperator.name}`));
    act(() => fake.switchUser('user-2', null));
    await waitFor(() => expect(state()).toHaveTextContent('out:not-enabled'));
    expect(fake.service.signOut).toHaveBeenCalledOnce();
  });

  it('ignores session events for the same user, such as a token refresh', async () => {
    const fake = createFakeAuthService({ userId: 'user-1' });
    renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent(`in:${fakeOperator.name}`));
    act(() => fake.switchUser('user-1', fakeOperator));
    expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
    expect(fake.service.loadIdentity).toHaveBeenCalledOnce();
  });

  describe('password recovery', () => {
    const linkOperator: Operator = { id: 'op-2', name: 'Marco Prova', role: 'operator' };
    const linkUser = { userId: 'user-2', operator: linkOperator, email: 'marco@example.com' };

    it('reads the email of the saved session', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', email: 'giulia@example.com' });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      await expect(auth().currentEmail()).resolves.toBe('giulia@example.com');
    });

    it('has no email when signed out', async () => {
      const auth = renderWith(createFakeAuthService());
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      await expect(auth().currentEmail()).resolves.toBeNull();
    });

    it('verifies the link, saves the password, signs out other devices and signs in', async () => {
      const fake = createFakeAuthService({ recoveryUser: linkUser });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('ok');
      expect(fake.service.verifyRecovery).toHaveBeenCalledWith('token-abc');
      expect(fake.service.updatePassword).toHaveBeenCalledWith('nuova-password');
      expect(fake.service.signOutOtherDevices).toHaveBeenCalledOnce();
      expect(fake.service.loadIdentity).toHaveBeenCalledOnce();
      expect(state()).toHaveTextContent('in:Marco Prova');
    });

    it('reports an invalid link without saving anything', async () => {
      const fake = createFakeAuthService({ verifyResults: ['invalid-link'] });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('invalid-link');
      expect(fake.service.updatePassword).not.toHaveBeenCalled();
      expect(state()).toHaveTextContent('out:-');
    });

    it('tells verification failures apart from save failures', async () => {
      const fake = createFakeAuthService({ verifyResults: ['network', 'unknown'] });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('verify-network');
      expect(await complete(auth)).toBe('verify-unknown');
      expect(fake.service.updatePassword).not.toHaveBeenCalled();
    });

    it('verifies again after a network failure on the verification', async () => {
      const fake = createFakeAuthService({ verifyResults: ['network', 'ok'] });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('verify-network');
      expect(await complete(auth)).toBe('ok');
      expect(fake.service.verifyRecovery).toHaveBeenCalledTimes(2);
    });

    it('keeps the signed-in user when the link cannot be verified', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', verifyResults: ['invalid-link'] });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent(`in:${fakeOperator.name}`));
      expect(await complete(auth)).toBe('invalid-link');
      expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
      act(() => fake.endSession());
      expect(state()).toHaveTextContent('out:expired');
    });

    it('maps save failures', async () => {
      const fake = createFakeAuthService({
        updatePasswordResults: ['same-password', 'weak', 'unknown', 'network'],
      });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('same-password');
      expect(await complete(auth)).toBe('weak');
      expect(await complete(auth)).toBe('save-unknown');
      expect(await complete(auth)).toBe('save-network');
    });

    it('retries only the save after a network failure, without verifying again', async () => {
      const fake = createFakeAuthService({
        recoveryUser: linkUser,
        updatePasswordResults: ['network', 'ok'],
      });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('save-network');
      expect(await complete(auth)).toBe('ok');
      expect(fake.service.verifyRecovery).toHaveBeenCalledOnce();
      expect(fake.service.updatePassword).toHaveBeenCalledTimes(2);
      expect(state()).toHaveTextContent('in:Marco Prova');
    });

    it('counts same-password after a network failure as saved', async () => {
      const fake = createFakeAuthService({
        recoveryUser: linkUser,
        updatePasswordResults: ['network', 'same-password'],
      });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('save-network');
      expect(await complete(auth)).toBe('ok');
      expect(fake.service.verifyRecovery).toHaveBeenCalledOnce();
      expect(fake.service.signOutOtherDevices).toHaveBeenCalledOnce();
      expect(state()).toHaveTextContent('in:Marco Prova');
    });

    it('still counts same-password as saved when another failure came after the lost save', async () => {
      const fake = createFakeAuthService({
        recoveryUser: linkUser,
        updatePasswordResults: ['network', 'unknown', 'same-password'],
      });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('save-network');
      expect(await complete(auth)).toBe('save-unknown');
      expect(await complete(auth)).toBe('ok');
      expect(fake.service.verifyRecovery).toHaveBeenCalledOnce();
      expect(state()).toHaveTextContent('in:Marco Prova');
    });

    it('verifies a different link again', async () => {
      const fake = createFakeAuthService({ updatePasswordResults: ['network', 'ok'] });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth, 'token-1')).toBe('save-network');
      expect(await complete(auth, 'token-2')).toBe('ok');
      expect(fake.service.verifyRecovery).toHaveBeenCalledTimes(2);
      expect(fake.service.verifyRecovery).toHaveBeenLastCalledWith('token-2');
    });

    it('signs out when the page is left after a verification but before the save', async () => {
      const fake = createFakeAuthService({
        recoveryUser: linkUser,
        updatePasswordResults: ['network'],
      });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('save-network');
      await act(() => auth().abandonRecovery());
      expect(fake.service.signOut).toHaveBeenCalledOnce();
      expect(state()).toHaveTextContent('out:-');
      // The next attempt starts from the link again.
      fake.service.updatePassword.mockResolvedValueOnce('ok');
      expect(await complete(auth)).toBe('ok');
      expect(fake.service.verifyRecovery).toHaveBeenCalledTimes(2);
    });

    it('verifies the link again after the user signs out', async () => {
      const fake = createFakeAuthService({ updatePasswordResults: ['network', 'ok'] });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('save-network');
      await act(() => auth().signOut());
      expect(await complete(auth)).toBe('ok');
      expect(fake.service.verifyRecovery).toHaveBeenCalledTimes(2);
    });

    it('does not sign out when the page is left without a verification', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', verifyResults: ['invalid-link'] });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      await act(() => auth().abandonRecovery());
      expect(await complete(auth)).toBe('invalid-link');
      await act(() => auth().abandonRecovery());
      expect(fake.service.signOut).not.toHaveBeenCalled();
      expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
    });

    it('does not sign out when the page is left after the save', async () => {
      const fake = createFakeAuthService({ recoveryUser: linkUser });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('ok');
      await act(() => auth().abandonRecovery());
      expect(fake.service.signOut).not.toHaveBeenCalled();
      expect(state()).toHaveTextContent('in:Marco Prova');
    });

    it('stops showing the previous operator once the link session replaces it', async () => {
      const fake = createFakeAuthService({
        userId: 'user-1',
        recoveryUser: linkUser,
        updatePasswordResults: ['network'],
      });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent(`in:${fakeOperator.name}`));
      expect(await complete(auth)).toBe('save-network');
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(state()).toHaveTextContent('out:-');
      expect(fake.service.loadIdentity).toHaveBeenCalledOnce();
    });

    it('switches to the link operator without a session-expired message', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', recoveryUser: linkUser });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent(`in:${fakeOperator.name}`));
      expect(await complete(auth)).toBe('ok');
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(state()).toHaveTextContent('in:Marco Prova');
      expect(fake.service.signOut).not.toHaveBeenCalled();
      // The new session is watched like any other.
      act(() => fake.endSession());
      expect(state()).toHaveTextContent('out:expired');
    });

    it('ends the session as not enabled when the link user has no profile', async () => {
      const fake = createFakeAuthService({
        recoveryUser: { userId: 'user-3', operator: null, email: 'nessuno@example.com' },
      });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      expect(await complete(auth)).toBe('not-enabled');
      expect(fake.service.updatePassword).toHaveBeenCalledOnce();
      expect(fake.service.signOut).toHaveBeenCalledOnce();
      expect(state()).toHaveTextContent('out:not-enabled');
    });

    it('keeps the new session and offers a retry when the profile cannot be loaded', async () => {
      const fake = createFakeAuthService({ recoveryUser: linkUser });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      fake.service.loadIdentity.mockRejectedValueOnce(new Error('offline'));
      expect(await complete(auth)).toBe('ok');
      expect(state()).toHaveTextContent('error');
      expect(fake.service.signOut).not.toHaveBeenCalled();
      await act(() => auth().retry());
      expect(state()).toHaveTextContent('in:Marco Prova');
    });
  });

  describe('re-checks the profile when the app comes back to the foreground', () => {
    afterEach(() => {
      // Back to jsdom's own getter.
      Reflect.deleteProperty(document, 'visibilityState');
    });

    it('ends the session when the profile is gone on window focus', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      fake.removeProfile();
      act(() => {
        fireEvent.focus(window);
      });
      await waitFor(() => expect(state()).toHaveTextContent('out:not-enabled'));
      expect(fake.service.signOut).toHaveBeenCalledOnce();
    });

    it('ends the session when the profile is gone and the page becomes visible', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      fake.removeProfile();
      setVisibility('visible');
      act(() => {
        fireEvent(document, new Event('visibilitychange'));
      });
      await waitFor(() => expect(state()).toHaveTextContent('out:not-enabled'));
    });

    it('does not check while the page is hidden', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      setVisibility('hidden');
      act(() => {
        fireEvent(document, new Event('visibilitychange'));
      });
      expect(fake.service.loadIdentity).toHaveBeenCalledOnce();
    });

    it('stays signed in when the profile is still there', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      act(() => {
        fireEvent.focus(window);
      });
      await waitFor(() => expect(fake.service.loadIdentity).toHaveBeenCalledTimes(2));
      expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
      expect(fake.service.signOut).not.toHaveBeenCalled();
    });

    it('updates a changed role', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      renderWith(fake);
      await waitFor(() => expect(role()).toHaveTextContent('admin'));
      fake.setProfile({ ...fakeOperator, role: 'operator' });
      act(() => {
        fireEvent.focus(window);
      });
      await waitFor(() => expect(role()).toHaveTextContent('operator'));
      expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
      expect(fake.service.signOut).not.toHaveBeenCalled();
    });

    it('stays signed in when the check fails offline', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      fake.service.loadIdentity.mockRejectedValueOnce(new Error('offline'));
      act(() => {
        fireEvent.focus(window);
      });
      await waitFor(() => expect(fake.service.loadIdentity).toHaveBeenCalledTimes(2));
      await act(() => Promise.resolve());
      expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
      expect(fake.service.signOut).not.toHaveBeenCalled();
    });

    it('does not check when signed out', async () => {
      const fake = createFakeAuthService();
      renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      act(() => {
        fireEvent.focus(window);
      });
      expect(fake.service.loadIdentity).not.toHaveBeenCalled();
    });

    it('stops listening after unmount', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      const { unmount } = render(
        <AuthProvider service={fake.service}>
          <Probe />
        </AuthProvider>,
      );
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      unmount();
      fireEvent.focus(window);
      expect(fake.service.loadIdentity).toHaveBeenCalledOnce();
    });
  });

  describe('reportNotEnabled', () => {
    const asOperator: Operator = { ...fakeOperator, role: 'operator' };

    it('ends the session as not enabled when the profile is gone', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      fake.removeProfile();
      await act(() => auth().reportNotEnabled());
      expect(state()).toHaveTextContent('out:not-enabled');
      expect(fake.service.signOut).toHaveBeenCalledOnce();
    });

    it('updates the role when the profile is still there', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      const auth = renderWith(fake);
      await waitFor(() => expect(role()).toHaveTextContent('admin'));
      fake.setProfile(asOperator);
      await act(() => auth().reportNotEnabled());
      expect(role()).toHaveTextContent('operator');
      expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
      expect(fake.service.loadIdentity).toHaveBeenCalledTimes(2);
      expect(fake.service.signOut).not.toHaveBeenCalled();
    });

    it('keeps the session and the role when the check fails offline', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      const auth = renderWith(fake);
      await waitFor(() => expect(role()).toHaveTextContent('admin'));
      fake.setProfile(asOperator);
      fake.service.loadIdentity.mockRejectedValueOnce(new Error('offline'));
      await act(() => auth().reportNotEnabled());
      expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
      expect(role()).toHaveTextContent('admin');
      expect(fake.service.signOut).not.toHaveBeenCalled();
    });

    it('does nothing when signed out', async () => {
      const fake = createFakeAuthService();
      const auth = renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      await act(() => auth().reportNotEnabled());
      expect(fake.service.loadIdentity).not.toHaveBeenCalled();
      expect(state()).toHaveTextContent('out:-');
    });

    it('checks again even while a foreground check is running, and keeps the newer answer', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      const auth = renderWith(fake);
      await waitFor(() => expect(role()).toHaveTextContent('admin'));
      // The foreground check reads the profile before the role changes and answers late.
      const stale = deferred<SessionIdentity | null>();
      fake.service.loadIdentity.mockReturnValueOnce(stale.promise);
      act(() => {
        fireEvent.focus(window);
      });
      fake.setProfile(asOperator);
      await act(() => auth().reportNotEnabled());
      expect(fake.service.loadIdentity).toHaveBeenCalledTimes(3);
      expect(role()).toHaveTextContent('operator');
      await act(async () =>
        stale.resolve({ kind: 'operator', operator: fakeOperator, hasPin: false }),
      );
      expect(role()).toHaveTextContent('operator');
    });
  });

  describe('device session', () => {
    const cashier: Operator = { id: 'op-2', name: 'Marco Prova', role: 'operator' };

    it('restores a device session without a cashier', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice });
      renderDevice(fake);
      await waitFor(() => expect(state()).toHaveTextContent('device'));
      expect(device()).toHaveTextContent(`${fakeDevice.name}|nessuno|-|0`);
      expect(fake.service.signOut).not.toHaveBeenCalled();
    });

    it('makes the cashier the current operator, with the end of the turn', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice, cashier });
      renderDevice(fake);
      await waitFor(() => expect(device()).toHaveTextContent(`${cashier.name}:operator`));
      const identity = await fake.service.loadIdentity.mock.results[0]?.value;
      if (identity?.kind !== 'device' || !identity.turnExpiresAt) throw new Error('no turn');
      expect(device()).toHaveTextContent(identity.turnExpiresAt.toISOString());
    });

    it('has no device in an operator session', async () => {
      renderDevice(createFakeAuthService({ userId: 'user-1' }));
      await waitFor(() => expect(state()).toHaveTextContent(`in:${fakeOperator.name}`));
      expect(device()).toHaveTextContent('-');
    });

    it('has no current operator on a device without a cashier', async () => {
      // React logs the error caught by the boundary.
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      onTestFinished(() => logged.mockRestore());
      const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice });
      render(
        <AuthProvider service={fake.service}>
          <Probe />
          <Refused>
            <Current />
          </Refused>
        </AuthProvider>,
      );
      await waitFor(() => expect(state()).toHaveTextContent('device'));
      expect(screen.getByTestId('current')).toHaveTextContent('refused');
    });

    it('is a device session right after signing in with a device account', async () => {
      const fake = createFakeAuthService({ device: fakeDevice });
      const auth = renderDevice(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      let result: string | undefined;
      await act(async () => {
        result = await auth().signIn('cassa@example.com', 'password-di-prova');
      });
      expect(result).toBe('ok');
      expect(state()).toHaveTextContent('device');
      expect(device()).toHaveTextContent(`${fakeDevice.name}|nessuno`);
      expect(fake.service.signOut).not.toHaveBeenCalled();
    });

    it('refreshIdentity picks up a new cashier and the lock from the server', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice });
      const auth = renderDevice(fake);
      await waitFor(() => expect(device()).toHaveTextContent('nessuno'));
      fake.setCashier(cashier);
      fake.setLock(120);
      await act(() => auth().refreshIdentity());
      expect(device()).toHaveTextContent(`${fakeDevice.name}|${cashier.name}:operator`);
      expect(device()).toHaveTextContent('|120');
    });

    it('refreshIdentity does nothing when signed out', async () => {
      const fake = createFakeAuthService();
      const auth = renderDevice(fake);
      await waitFor(() => expect(state()).toHaveTextContent('out:-'));
      await act(() => auth().refreshIdentity());
      expect(fake.service.loadIdentity).not.toHaveBeenCalled();
    });

    it('reportNotEnabled ends the turn on the device instead of signing out', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice, cashier });
      const auth = renderDevice(fake);
      await waitFor(() => expect(device()).toHaveTextContent(cashier.name));
      fake.expireTurn();
      await act(() => auth().reportNotEnabled());
      expect(state()).toHaveTextContent('device');
      expect(device()).toHaveTextContent(`${fakeDevice.name}|nessuno|-`);
      expect(fake.service.signOut).not.toHaveBeenCalled();
    });

    it('reportNotEnabled keeps the cashier when the check fails offline', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice, cashier });
      const auth = renderDevice(fake);
      await waitFor(() => expect(device()).toHaveTextContent(cashier.name));
      fake.expireTurn();
      fake.service.loadIdentity.mockRejectedValueOnce(new Error('offline'));
      await act(() => auth().reportNotEnabled());
      expect(device()).toHaveTextContent(cashier.name);
    });

    it('reportNotEnabled signs out as not enabled when the device account is gone', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice, cashier });
      const auth = renderDevice(fake);
      await waitFor(() => expect(device()).toHaveTextContent(cashier.name));
      fake.removeProfile();
      await act(() => auth().reportNotEnabled());
      expect(state()).toHaveTextContent('out:not-enabled');
      expect(fake.service.signOut).toHaveBeenCalledOnce();
    });

    it('ends the turn when the app comes back to the foreground after it expired', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice, cashier });
      renderDevice(fake);
      await waitFor(() => expect(device()).toHaveTextContent(cashier.name));
      fake.expireTurn();
      act(() => {
        fireEvent.focus(window);
      });
      await waitFor(() => expect(device()).toHaveTextContent('nessuno'));
    });

    it('signs out without a reason from a device session ("Disconnetti il tablet")', async () => {
      const fake = createFakeAuthService({ userId: 'user-1', device: fakeDevice, cashier });
      const auth = renderDevice(fake);
      await waitFor(() => expect(device()).toHaveTextContent(cashier.name));
      await act(() => auth().signOut());
      expect(state()).toHaveTextContent('out:-');
      expect(device()).toHaveTextContent('-');
    });
  });
});
