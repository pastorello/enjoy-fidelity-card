import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeAuthService, fakeOperator } from '../../test/fakeAuthService';
import type { Operator } from './types';
import { AuthProvider, useAuth } from './AuthProvider';

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
      <Capture />
    </AuthProvider>,
  );
  return () => {
    if (!captured.auth) throw new Error('useAuth not rendered');
    return captured.auth;
  };
}

const state = () => screen.getByTestId('state');

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
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
    expect(fake.service.loadOperator).toHaveBeenCalledWith('user-1');
  });

  it('ends a saved session whose user has no profile', async () => {
    const fake = createFakeAuthService({ userId: 'user-1', operator: null });
    renderWith(fake);
    await waitFor(() => expect(state()).toHaveTextContent('out:not-enabled'));
    expect(fake.service.signOut).toHaveBeenCalledOnce();
  });

  it('shows an error state when the profile cannot be loaded, and retries', async () => {
    const fake = createFakeAuthService({ userId: 'user-1' });
    fake.service.loadOperator.mockRejectedValueOnce(new Error('offline'));
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
    fake.service.loadOperator.mockRejectedValueOnce(new Error('offline'));
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
    expect(fake.service.loadOperator).toHaveBeenLastCalledWith('user-2');
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
    expect(fake.service.loadOperator).toHaveBeenCalledOnce();
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
      expect(fake.service.loadOperator).toHaveBeenCalledOnce();
    });

    it('stays signed in when the profile is still there', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      act(() => {
        fireEvent.focus(window);
      });
      await waitFor(() => expect(fake.service.loadOperator).toHaveBeenCalledTimes(2));
      expect(fake.service.loadOperator).toHaveBeenLastCalledWith('user-1');
      expect(state()).toHaveTextContent(`in:${fakeOperator.name}`);
      expect(fake.service.signOut).not.toHaveBeenCalled();
    });

    it('stays signed in when the check fails offline', async () => {
      const fake = createFakeAuthService({ userId: 'user-1' });
      renderWith(fake);
      await waitFor(() => expect(state()).toHaveTextContent('in:'));
      fake.service.loadOperator.mockRejectedValueOnce(new Error('offline'));
      act(() => {
        fireEvent.focus(window);
      });
      await waitFor(() => expect(fake.service.loadOperator).toHaveBeenCalledTimes(2));
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
      expect(fake.service.loadOperator).not.toHaveBeenCalled();
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
      expect(fake.service.loadOperator).toHaveBeenCalledOnce();
    });
  });
});
