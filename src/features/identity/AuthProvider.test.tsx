import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { createFakeAuthService, fakeOperator } from '../../test/fakeAuthService';
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
});
