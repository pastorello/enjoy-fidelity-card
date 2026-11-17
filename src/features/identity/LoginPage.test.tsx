import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeAuthService } from '../../test/fakeAuthService';
import { renderApp, signedInFake } from '../../test/renderApp';

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  await screen.findByRole('heading', { level: 1, name: 'Accedi' });
  if (email) await user.type(await screen.findByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Accedi' }));
}

describe('sign-in page', () => {
  it('shows the form with accessible fields and the note about accounts', async () => {
    renderApp('/accedi');
    expect(await screen.findByRole('heading', { level: 1, name: 'Accedi' })).toBeInTheDocument();
    expect(screen.getByText('Enjoy Card')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByText(/Gli account li crea un amministratore/)).toBeInTheDocument();
  });

  it('links "Password dimenticata?" below the button to the recovery page', async () => {
    const { router } = renderApp('/accedi');
    const link = await screen.findByRole('link', { name: 'Password dimenticata?' });
    expect(link).toHaveAttribute('href', '/password-dimenticata');
    // Below "Accedi", above the V1 note.
    const button = screen.getByRole('button', { name: 'Accedi' });
    const note = screen.getByText(/Gli account li crea un amministratore/);
    expect(button.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(link);
    expect(router.state.location.pathname).toBe('/password-dimenticata');
  });

  it('asks for the missing fields without calling the server', async () => {
    const { fake } = renderApp('/accedi');
    await fillAndSubmit('', '');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Inserisci l’email');
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Inserisci la password');
    expect(fake.service.signIn).not.toHaveBeenCalled();
  });

  it('says only that email or password are wrong, and clears the password', async () => {
    renderApp('/accedi', createFakeAuthService({ signInResult: 'invalid' }));
    await fillAndSubmit('giulia@example.com', 'sbagliata');
    expect(await screen.findByRole('alert')).toHaveTextContent('Email o password non corretti.');
    expect(screen.getByLabelText('Email')).toHaveValue('giulia@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it.each([
    ['network', 'Connessione assente: controlla la rete e riprova.'],
    ['rate-limited', 'Troppi tentativi. Aspetta qualche minuto e riprova.'],
    ['unknown', 'Accesso non riuscito. Riprova tra poco.'],
  ] as const)('explains a %s failure', async (signInResult, message) => {
    renderApp('/accedi', createFakeAuthService({ signInResult }));
    await fillAndSubmit('giulia@example.com', 'password-di-prova');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('reports a network failure and stops waiting when the profile cannot be loaded', async () => {
    const fake = createFakeAuthService();
    fake.service.loadOperator.mockRejectedValueOnce(new Error('offline'));
    renderApp('/accedi', fake);
    await fillAndSubmit('giulia@example.com', 'password-di-prova');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connessione assente: controlla la rete e riprova.',
    );
    expect(screen.getByRole('button', { name: 'Accedi' })).not.toHaveAttribute('aria-busy');
    expect(fake.service.signOut).toHaveBeenCalledOnce();
  });

  it.each([
    ['misconfigured', 'Servizio non configurato: chiedi a un amministratore.'],
    ['unavailable', 'Servizio momentaneamente non disponibile: riprova tra poco.'],
  ] as const)('tells a %s server apart from a missing connection', async (kind, message) => {
    const fake = createFakeAuthService();
    fake.service.loadOperator.mockRejectedValueOnce(new ServerFaultError(kind));
    renderApp('/accedi', fake);
    await fillAndSubmit('giulia@example.com', 'password-di-prova');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('refuses an account without an operator profile', async () => {
    renderApp('/accedi', createFakeAuthService({ operator: null }));
    await fillAndSubmit('nuovo@example.com', 'password-di-prova');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Account non abilitato: chiedi a un amministratore.',
    );
  });

  it('marks the button busy while signing in', async () => {
    const fake = createFakeAuthService();
    fake.service.signIn.mockReturnValueOnce(new Promise(() => {}));
    renderApp('/accedi', fake);
    await fillAndSubmit('giulia@example.com', 'password-di-prova');
    expect(screen.getByRole('button', { name: 'Accedi' })).toHaveAttribute('aria-busy', 'true');
  });

  it('goes to the home after signing in', async () => {
    const { router } = renderApp('/accedi');
    await fillAndSubmit('giulia@example.com', 'password-di-prova');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('leaves the page when already signed in', async () => {
    const { router } = renderApp('/accedi', signedInFake());
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

describe('protected pages', () => {
  it('send to the sign-in page without a session, then back to the page asked for', async () => {
    const { router } = renderApp('/?vista=1');
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    await fillAndSubmit('giulia@example.com', 'password-di-prova');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.location.search).toBe('?vista=1');
  });

  it('show the page when signed in', async () => {
    renderApp('/', signedInFake());
    expect(await screen.findByText('Enjoy Card è quasi pronta')).toBeInTheDocument();
  });

  it('tell a user without a profile that the account is not enabled', async () => {
    renderApp('/', signedInFake({ operator: null }));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toHaveRole('status');
  });

  it('tell the user when the session has expired', async () => {
    const { fake } = renderApp('/', signedInFake());
    await screen.findByText('Enjoy Card è quasi pronta');
    fake.endSession();
    expect(await screen.findByText('La sessione è scaduta: accedi di nuovo.')).toHaveRole('status');
    expect(screen.getByRole('heading', { level: 1, name: 'Accedi' })).toBeInTheDocument();
  });

  it('say the service is not configured when the saved profile cannot be loaded for that', async () => {
    const fake = signedInFake();
    fake.service.loadOperator.mockRejectedValueOnce(new ServerFaultError('misconfigured'));
    renderApp('/', fake);
    expect(
      await screen.findByText('Servizio non configurato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Controlla la connessione e riprova.')).not.toBeInTheDocument();
  });

  it('offer "Riprova" when the profile cannot be loaded', async () => {
    const fake = signedInFake();
    fake.service.loadOperator.mockRejectedValueOnce(new Error('offline'));
    renderApp('/', fake);
    await userEvent.click(await screen.findByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Enjoy Card è quasi pronta')).toBeInTheDocument();
  });
});
