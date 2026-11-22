import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeAuthService, fakeOperator } from '../../test/fakeAuthService';
import { renderApp, signedInFake } from '../../test/renderApp';

const LINK = '/imposta-password?token_hash=hash-1&type=recovery';
const INVALID = 'Il link è scaduto o è già stato usato.';
const linkUser = {
  userId: 'user-2',
  operator: { id: 'op-2', name: 'Marco Prova', role: 'operator' as const },
  email: 'marco@example.com',
};

/** A promise the test settles by hand (the app's TS lib predates Promise.withResolvers). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function openForm() {
  await screen.findByRole('heading', { level: 1, name: 'Scegli una nuova password' });
}

async function fill(password: string, repeat = password) {
  const user = userEvent.setup();
  await openForm();
  const first = screen.getByLabelText('Nuova password');
  const second = screen.getByLabelText('Ripeti la password');
  await user.clear(first);
  await user.clear(second);
  if (password) await user.type(first, password);
  if (repeat) await user.type(second, repeat);
  await user.click(screen.getByRole('button', { name: 'Salva e accedi' }));
}

async function expectInvalidLinkView(router: ReturnType<typeof renderApp>['router']) {
  expect(await screen.findByRole('heading', { level: 1, name: INVALID })).toBeInTheDocument();
  expect(screen.queryByLabelText('Nuova password')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Chiedi un nuovo link' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/password-dimenticata'));
}

describe('reset password page', () => {
  it('is public and shows the logo, title, text and fields of the wireframe', async () => {
    renderApp(LINK);
    await openForm();
    expect(screen.getByText('Bar Enjoy Gaeta')).toBeInTheDocument();
    expect(screen.getByText('Scegli la password per accedere all’Enjoy Card.')).toBeInTheDocument();
    const first = screen.getByLabelText('Nuova password');
    expect(first).toHaveAttribute('type', 'password');
    expect(first).toHaveAttribute('autocomplete', 'new-password');
    expect(first).toHaveAccessibleDescription('Almeno 8 caratteri.');
    expect(screen.getByLabelText('Ripeti la password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    // No email field and no back link, as in the wireframe.
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Indietro' })).not.toBeInTheDocument();
  });

  it('saves the password and opens the home in place of the page', async () => {
    const fake = createFakeAuthService({ recoveryUser: linkUser });
    const { router } = renderApp(LINK, fake);
    await fill('nuova-password');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fake.service.verifyRecovery).toHaveBeenCalledExactlyOnceWith('hash-1');
    expect(fake.service.updatePassword).toHaveBeenCalledExactlyOnceWith('nuova-password');
    expect(fake.service.signOutOtherDevices).toHaveBeenCalledOnce();
  });

  describe('checks the password before calling the server', () => {
    it.each([
      ['shorter than 8 characters', '1234567', '1234567', 'Nuova password', 'Almeno 8 caratteri.'],
      [
        'longer than 72 bytes',
        'a'.repeat(73),
        'a'.repeat(73),
        'Nuova password',
        'Password troppo lunga.',
      ],
      [
        'of 40 "è" (80 bytes)',
        'è'.repeat(40),
        'è'.repeat(40),
        'Nuova password',
        'Password troppo lunga.',
      ],
      [
        'repeated differently',
        'nuova-password',
        'nuova-passwora',
        'Ripeti la password',
        'Le password non coincidono.',
      ],
    ])('%s', async (_, password, repeat, field, message) => {
      const { fake } = renderApp(LINK);
      await fill(password, repeat);
      expect(screen.getByLabelText(field)).toHaveAccessibleDescription(message);
      expect(fake.service.verifyRecovery).not.toHaveBeenCalled();
      expect(fake.service.updatePassword).not.toHaveBeenCalled();
    });

    it('accepts exactly 8 characters', async () => {
      const { fake, router } = renderApp(LINK);
      await fill('12345678');
      await waitFor(() => expect(router.state.location.pathname).toBe('/'));
      expect(fake.service.updatePassword).toHaveBeenCalledExactlyOnceWith('12345678');
    });

    it('accepts exactly 72 bytes', async () => {
      const { fake } = renderApp(LINK);
      await fill('è'.repeat(36));
      await waitFor(() => expect(fake.service.updatePassword).toHaveBeenCalledOnce());
    });
  });

  it('sends one request for a double tap and marks the button busy', async () => {
    const fake = createFakeAuthService();
    const answer = deferred<'ok'>();
    fake.service.updatePassword.mockReturnValueOnce(answer.promise);
    const { router } = renderApp(LINK, fake);
    const user = userEvent.setup();
    await openForm();
    await user.type(screen.getByLabelText('Nuova password'), 'nuova-password');
    await user.type(screen.getByLabelText('Ripeti la password'), 'nuova-password');
    await user.dblClick(screen.getByRole('button', { name: 'Salva e accedi' }));
    expect(screen.getByRole('button', { name: 'Salva e accedi' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    answer.resolve('ok');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(fake.service.verifyRecovery).toHaveBeenCalledOnce();
    expect(fake.service.updatePassword).toHaveBeenCalledOnce();
  });

  describe('shows the expired-link view', () => {
    it.each([
      ['without token_hash', '/imposta-password?type=recovery'],
      ['without type', '/imposta-password?token_hash=hash-1'],
      ['with another type', '/imposta-password?token_hash=hash-1&type=signup'],
      [
        'with an error in the fragment',
        `${LINK}#error=access_denied&error_code=otp_expired&error_description=x`,
      ],
      ['with only error_code in the fragment', `${LINK}#error_code=otp_expired`],
    ])('at once %s', async (_, path) => {
      const { fake, router } = renderApp(path);
      await expectInvalidLinkView(router);
      expect(fake.service.verifyRecovery).not.toHaveBeenCalled();
    });

    it('not for a fragment that only contains the word "error"', async () => {
      const { fake, router } = renderApp(`${LINK}#nota=Terrore`);
      await fill('nuova-password');
      await waitFor(() => expect(router.state.location.pathname).toBe('/'));
      expect(fake.service.verifyRecovery).toHaveBeenCalledOnce();
    });

    it('when the server says the link is used or expired', async () => {
      const fake = createFakeAuthService({ verifyResults: ['invalid-link'] });
      const { router } = renderApp(LINK, fake);
      await fill('nuova-password');
      expect(fake.service.updatePassword).not.toHaveBeenCalled();
      // The focused button is gone: the new heading takes focus so a screen reader reads it.
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 1, name: INVALID })).toHaveFocus(),
      );
      await expectInvalidLinkView(router);
    });
  });

  describe('reports what went wrong', () => {
    it.each([
      [
        'a missing connection on the verification',
        { verifyResults: ['network' as const] },
        'Connessione assente: riprova.',
      ],
      [
        'any other verification failure',
        { verifyResults: ['unknown' as const] },
        'Non è stato possibile verificare il link. Riprova tra poco.',
      ],
      [
        'a missing connection on the save',
        { updatePasswordResults: ['network' as const] },
        'Connessione assente: la password non è stata salvata. Riprova.',
      ],
      [
        'any other save failure',
        { updatePasswordResults: ['unknown' as const] },
        'Password non salvata. Riprova tra poco.',
      ],
    ])('%s', async (_, options, message) => {
      const { router } = renderApp(LINK, createFakeAuthService(options));
      await fill('nuova-password');
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(router.state.location.pathname).toBe('/imposta-password');
      expect(screen.getByLabelText('Nuova password')).toHaveValue('nuova-password');
    });

    it.each([
      ['same-password' as const, 'La nuova password deve essere diversa da quella attuale.'],
      ['weak' as const, 'Almeno 8 caratteri.'],
    ])('the server answer %s on the new password', async (result, message) => {
      const fake = createFakeAuthService({ updatePasswordResults: [result] });
      renderApp(LINK, fake);
      await fill('nuova-password');
      await waitFor(() =>
        expect(screen.getByLabelText('Nuova password')).toHaveAccessibleDescription(message),
      );
    });

    it('treats an unexpected failure like a failed save', async () => {
      const fake = createFakeAuthService();
      fake.service.updatePassword.mockRejectedValueOnce(new Error('boom'));
      renderApp(LINK, fake);
      await fill('nuova-password');
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Password non salvata. Riprova tra poco.',
      );
    });
  });

  it('after a lost save, sends the password again without a second verification', async () => {
    const fake = createFakeAuthService({ updatePasswordResults: ['network', 'ok'] });
    const { router } = renderApp(LINK, fake);
    await fill('nuova-password');
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Salva e accedi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(fake.service.verifyRecovery).toHaveBeenCalledOnce();
    expect(fake.service.updatePassword).toHaveBeenCalledTimes(2);
  });

  it('after a lost verification, verifies again on the next tap', async () => {
    const fake = createFakeAuthService({ verifyResults: ['network', 'ok'] });
    const { router } = renderApp(LINK, fake);
    await fill('nuova-password');
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Salva e accedi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(fake.service.verifyRecovery).toHaveBeenCalledTimes(2);
  });

  it('after a lost verification, shows the expired-link view if the first one had landed', async () => {
    const fake = createFakeAuthService({ verifyResults: ['network', 'invalid-link'] });
    const { router } = renderApp(LINK, fake);
    await fill('nuova-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Connessione assente: riprova.');
    await userEvent.click(screen.getByRole('button', { name: 'Salva e accedi' }));
    expect(await screen.findByRole('heading', { level: 1, name: INVALID })).toBeInTheDocument();
    expect(fake.service.verifyRecovery).toHaveBeenCalledTimes(2);
    expect(fake.service.updatePassword).not.toHaveBeenCalled();
    await expectInvalidLinkView(router);
  });

  it('says the service is not configured when the profile read after saving hits a fault', async () => {
    const fake = createFakeAuthService({ recoveryUser: linkUser });
    fake.service.loadIdentity.mockRejectedValueOnce(new ServerFaultError('misconfigured'));
    renderApp(LINK, fake);
    await fill('nuova-password');
    expect(
      await screen.findByText('Servizio non configurato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
    expect(fake.service.updatePassword).toHaveBeenCalledOnce();
  });

  it('sends an account without profile to the sign-in page as "not enabled"', async () => {
    const fake = createFakeAuthService({ recoveryUser: { ...linkUser, operator: null } });
    const { router } = renderApp(LINK, fake);
    await fill('nuova-password');
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(fake.service.updatePassword).toHaveBeenCalledOnce();
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
  });

  describe('when already signed in', () => {
    it('warns that saving signs in with the link’s account', async () => {
      const fake = signedInFake({ recoveryUser: linkUser });
      const { router } = renderApp(LINK, fake);
      expect(
        await screen.findByText(
          `Sei collegato come ${fakeOperator.name}: salvando, accederai con l’account del link.`,
        ),
      ).toBeInTheDocument();
      await fill('nuova-password');
      await waitFor(() => expect(router.state.location.pathname).toBe('/'));
      await waitFor(() =>
        expect(
          screen.getByRole('link', { name: `Account e impostazioni: ${linkUser.operator.name}` }),
        ).toBeInTheDocument(),
      );
      expect(screen.queryByText(/sessione è scaduta/)).not.toBeInTheDocument();
    });

    it('stays signed in when opening the page without a link', async () => {
      const fake = signedInFake();
      const { router } = renderApp('/imposta-password', fake);
      await expectInvalidLinkView(router);
      expect(fake.service.signOut).not.toHaveBeenCalled();
      expect(await screen.findByLabelText('Email')).toHaveValue('giulia@example.com');
    });
  });

  it('leaving after a verification without a saved password signs out', async () => {
    const fake = signedInFake({
      recoveryUser: linkUser,
      updatePasswordResults: ['unknown'],
    });
    const { router } = renderApp(LINK, fake);
    await fill('nuova-password');
    await screen.findByRole('alert');
    await router.navigate('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(fake.service.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByText(/sessione è scaduta/)).not.toBeInTheDocument();
  });

  it('leaving without a verification keeps the session', async () => {
    const fake = signedInFake();
    const { router } = renderApp(LINK, fake);
    await openForm();
    await router.navigate('/impostazioni');
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
    expect(fake.service.signOut).not.toHaveBeenCalled();
  });
});

const INVITE = '/imposta-password?token_hash=hash-1&type=invite';
const MARCO = `${INVITE}#nome=Marco&da=Andrea&ruolo=operatore`;
const GENERIC_TITLE = 'Scegli la password';
const GENERIC_TEXT = 'Sei stato invitato all’Enjoy Card. Scegli la password per accedere.';

async function fillInvite(title: string, password = 'nuova-password') {
  const user = userEvent.setup();
  await screen.findByRole('heading', { level: 1, name: title });
  await user.type(screen.getByLabelText('Nuova password'), password);
  await user.type(screen.getByLabelText('Ripeti la password'), password);
  await user.click(screen.getByRole('button', { name: 'Salva e accedi' }));
}

async function expectExpiredInviteView(router: ReturnType<typeof renderApp>['router']) {
  expect(await screen.findByRole('heading', { level: 1, name: INVALID })).toBeInTheDocument();
  expect(
    screen.getByText('Chiedi a chi ti ha invitato di mandarti un nuovo invito.'),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText('Nuova password')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Chiedi un nuovo link' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Vai all’accesso' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
}

describe('reset password page, invite version', () => {
  it('greets the invited person with the texts of the fragment, without an email field', async () => {
    renderApp(MARCO);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ciao, Marco' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Andrea ti ha invitato come operatore dell’Enjoy Card. Scegli la password per accedere.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Bar Enjoy Gaeta')).toBeInTheDocument();
    expect(screen.getByLabelText('Nuova password')).toHaveAccessibleDescription(
      'Almeno 8 caratteri.',
    );
    expect(screen.getByLabelText('Ripeti la password')).toBeInTheDocument();
    // Declared deviation from the wireframe: no read-only email (it is known only after the check).
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('decodes the fragment and accepts an administrator and names of 60 characters', async () => {
    const name = 'M'.repeat(60);
    renderApp(`${INVITE}#nome=${name}&da=Anna%20Maria+Prova&ruolo=amministratore`);
    expect(
      await screen.findByRole('heading', { level: 1, name: `Ciao, ${name}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Anna Maria Prova ti ha invitato come amministratore dell’Enjoy Card. Scegli la password per accedere.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the texts as text, never as markup', async () => {
    renderApp(`${INVITE}#nome=%3Cb%3EMarco%3C%2Fb%3E&da=Andrea&ruolo=operatore`);
    const heading = await screen.findByRole('heading', { level: 1, name: 'Ciao, <b>Marco</b>' });
    expect(heading.querySelector('b')).toBeNull();
  });

  it('sets a name Enjoy Display lacks in the body font inside the title', async () => {
    renderApp(`${INVITE}#nome=*Stella&da=Andrea&ruolo=operatore`);
    const heading = await screen.findByRole('heading', { level: 1, name: 'Ciao, *Stella' });
    expect(heading.querySelector('[data-body-font="true"]')).toHaveTextContent('*Stella');
  });

  describe('falls back to the generic texts', () => {
    it.each([
      ['without a fragment', INVITE],
      ['without nome', `${INVITE}#da=Andrea&ruolo=operatore`],
      ['with an empty nome', `${INVITE}#nome=&da=Andrea&ruolo=operatore`],
      ['with a blank nome', `${INVITE}#nome=%20%20&da=Andrea&ruolo=operatore`],
      ['with nome of 61 characters', `${INVITE}#nome=${'M'.repeat(61)}&da=Andrea&ruolo=operatore`],
      ['without da', `${INVITE}#nome=Marco&ruolo=operatore`],
      ['with da of 61 characters', `${INVITE}#nome=Marco&da=${'A'.repeat(61)}&ruolo=operatore`],
      ['without ruolo', `${INVITE}#nome=Marco&da=Andrea`],
      ['with another ruolo', `${INVITE}#nome=Marco&da=Andrea&ruolo=titolare`],
      ['with the role in another case', `${INVITE}#nome=Marco&da=Andrea&ruolo=Operatore`],
    ])('%s', async (_, path) => {
      renderApp(path);
      expect(
        await screen.findByRole('heading', { level: 1, name: GENERIC_TITLE }),
      ).toBeInTheDocument();
      expect(screen.getByText(GENERIC_TEXT)).toBeInTheDocument();
      expect(screen.queryByText(/ti ha invitato come/)).not.toBeInTheDocument();
      expect(screen.getByLabelText('Nuova password')).toBeInTheDocument();
    });
  });

  it('accepts the invite, saves the password and opens the home', async () => {
    const fake = createFakeAuthService({ recoveryUser: linkUser });
    const { router } = renderApp(MARCO, fake);
    await fillInvite('Ciao, Marco');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fake.service.verifyInvite).toHaveBeenCalledExactlyOnceWith('hash-1');
    expect(fake.service.verifyRecovery).not.toHaveBeenCalled();
    expect(fake.service.updatePassword).toHaveBeenCalledExactlyOnceWith('nuova-password');
    // A person just invited has no other sessions.
    expect(fake.service.signOutOtherDevices).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: `Account e impostazioni: ${linkUser.operator.name}` }),
      ).toBeInTheDocument(),
    );
  });

  it('checks the password before calling the server, as in the recovery', async () => {
    const { fake } = renderApp(MARCO);
    await fillInvite('Ciao, Marco', '1234567');
    expect(screen.getByLabelText('Nuova password')).toHaveAccessibleDescription(
      'Almeno 8 caratteri.',
    );
    expect(fake.service.verifyInvite).not.toHaveBeenCalled();
  });

  it('a name that contains "error" does not expire the link', async () => {
    const fake = createFakeAuthService({ recoveryUser: linkUser });
    const { router } = renderApp(`${INVITE}#nome=Terrore&da=Errico&ruolo=operatore`, fake);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ciao, Terrore' }),
    ).toBeInTheDocument();
    await fillInvite('Ciao, Terrore');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(fake.service.verifyInvite).toHaveBeenCalledOnce();
  });

  describe('shows the expired-invite view', () => {
    it.each([
      ['with error_code in the fragment', `${MARCO}&error_code=otp_expired`],
      ['with error in the fragment', `${INVITE}#error=access_denied&error_description=x`],
      ['without token_hash', '/imposta-password?type=invite#nome=Marco&da=Andrea&ruolo=operatore'],
    ])('at once %s', async (_, path) => {
      const { fake, router } = renderApp(path);
      await expectExpiredInviteView(router);
      expect(fake.service.verifyInvite).not.toHaveBeenCalled();
    });

    it('when the server says the invite is expired, used or replaced', async () => {
      const fake = createFakeAuthService({ verifyResults: ['invalid-link'] });
      const { router } = renderApp(MARCO, fake);
      await fillInvite('Ciao, Marco');
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 1, name: INVALID })).toHaveFocus(),
      );
      expect(fake.service.updatePassword).not.toHaveBeenCalled();
      await expectExpiredInviteView(router);
    });
  });

  it('after a lost save, sends the password again without a second verification', async () => {
    const fake = createFakeAuthService({ updatePasswordResults: ['network', 'ok'] });
    const { router } = renderApp(MARCO, fake);
    await fillInvite('Ciao, Marco');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connessione assente: la password non è stata salvata. Riprova.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Salva e accedi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(fake.service.verifyInvite).toHaveBeenCalledOnce();
    expect(fake.service.updatePassword).toHaveBeenCalledTimes(2);
  });

  it('a deactivated invited account saves the password, then goes to the sign-in page', async () => {
    const fake = createFakeAuthService({ recoveryUser: { ...linkUser, operator: null } });
    const { router } = renderApp(MARCO, fake);
    await fillInvite('Ciao, Marco');
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(fake.service.updatePassword).toHaveBeenCalledOnce();
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
  });
});
