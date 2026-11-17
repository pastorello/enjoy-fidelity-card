import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createFakeAuthService } from '../../test/fakeAuthService';
import { renderApp, signedInFake } from '../../test/renderApp';

const CONFIRMATION =
  'Se l’email è di un account dell’Enjoy Card, ti abbiamo mandato un link. Il link vale un’ora: se non arriva, controlla lo spam o chiedi a un amministratore.';
const NETWORK = 'Connessione assente: controlla la rete e riprova.';

/** A promise the test settles by hand (the app's TS lib predates Promise.withResolvers). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function openPage() {
  await screen.findByRole('heading', { level: 1, name: 'Password dimenticata' });
}

async function send(email: string) {
  const user = userEvent.setup();
  await openPage();
  const field = screen.getByLabelText('Email');
  await user.clear(field);
  if (email) await user.type(field, email);
  await user.click(screen.getByRole('button', { name: 'Invia il link' }));
}

describe('forgot password page', () => {
  it('is public and shows the text, the email field and the note of the wireframe', async () => {
    renderApp('/password-dimenticata');
    await openPage();
    expect(
      screen.getByText(
        'Scrivi l’email del tuo account: ti mandiamo un link per sceglierne una nuova.',
      ),
    ).toBeInTheDocument();
    const field = screen.getByLabelText('Email');
    expect(field).toHaveAttribute('type', 'email');
    expect(field).toHaveAttribute('autocomplete', 'email');
    expect(field).toHaveAttribute('placeholder', 'nome@esempio.it');
    expect(field).toHaveValue('');
    expect(
      screen.getByText(
        'Il link vale un’ora. Se non arriva, controlla lo spam o chiedi a un amministratore.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/accedi');
  });

  it('asks for the email, or a valid one, without calling the server', async () => {
    const { fake } = renderApp('/password-dimenticata');
    await send('');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Inserisci l’email');
    await send('giulia.example.com');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Email non valida');
    await send('giulia@');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Email non valida');
    expect(fake.service.requestPasswordReset).not.toHaveBeenCalled();
  });

  it.each(['giulia@example.com', 'nessuno@example.com'])(
    'gives the same confirmation for %s, with the trimmed email and the app’s own return page',
    async (email) => {
      const { fake, router } = renderApp('/password-dimenticata');
      await send(`  ${email} `);
      expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
      expect(fake.service.requestPasswordReset).toHaveBeenCalledExactlyOnceWith(
        email,
        `${window.location.origin}/imposta-password`,
      );
      expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('link', { name: 'Torna all’accesso' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    },
  );

  it('never builds the return page from what was typed', async () => {
    const { fake } = renderApp('/password-dimenticata');
    await send('a@evil.example/imposta-password');
    await screen.findByText(CONFIRMATION);
    const [, redirectTo] = fake.service.requestPasswordReset.mock.calls[0] ?? [];
    expect(redirectTo).toBe(`${window.location.origin}/imposta-password`);
  });

  it('reports a missing connection, keeps the form filled and sends again', async () => {
    const fake = createFakeAuthService({ resetResults: ['network', 'sent'] });
    renderApp('/password-dimenticata', fake);
    await send('giulia@example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK);
    expect(screen.getByLabelText('Email')).toHaveValue('giulia@example.com');

    await userEvent.click(screen.getByRole('button', { name: 'Invia il link' }));
    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
    expect(fake.service.requestPasswordReset).toHaveBeenCalledTimes(2);
  });

  it('treats an unexpected failure like a missing connection', async () => {
    const fake = createFakeAuthService();
    fake.service.requestPasswordReset.mockRejectedValueOnce(new Error('offline'));
    renderApp('/password-dimenticata', fake);
    await send('giulia@example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK);
    expect(screen.getByLabelText('Email')).toHaveValue('giulia@example.com');
  });

  it('sends one request for a double tap and marks the button busy', async () => {
    const fake = createFakeAuthService();
    const answer = deferred<'sent'>();
    fake.service.requestPasswordReset.mockReturnValueOnce(answer.promise);
    renderApp('/password-dimenticata', fake);
    const user = userEvent.setup();
    await openPage();
    await user.type(screen.getByLabelText('Email'), 'giulia@example.com');
    await user.dblClick(screen.getByRole('button', { name: 'Invia il link' }));
    expect(screen.getByRole('button', { name: 'Invia il link' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    answer.resolve('sent');
    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
    expect(fake.service.requestPasswordReset).toHaveBeenCalledOnce();
  });

  describe('when signed in', () => {
    it('prefills the session email, editable, and goes back to the settings', async () => {
      const { fake, router } = renderApp(
        '/password-dimenticata',
        signedInFake({ email: 'operatore@example.com' }),
      );
      await openPage();
      const field = screen.getByLabelText('Email');
      await waitFor(() => expect(field).toHaveValue('operatore@example.com'));
      expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute(
        'href',
        '/impostazioni',
      );
      // The email never travels in the URL.
      expect(router.state.location.search).toBe('');

      await userEvent.clear(field);
      await userEvent.type(field, 'altra@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Invia il link' }));
      expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
      expect(fake.service.requestPasswordReset).toHaveBeenCalledWith(
        'altra@example.com',
        `${window.location.origin}/imposta-password`,
      );
      await userEvent.click(screen.getByRole('link', { name: 'Torna alle impostazioni' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/impostazioni'));
    });

    it('does not overwrite what the user already typed', async () => {
      const fake = signedInFake({ email: 'operatore@example.com' });
      const answerEmail = deferred<string | null>();
      fake.service.currentEmail.mockReturnValueOnce(answerEmail.promise);
      renderApp('/password-dimenticata', fake);
      await openPage();
      await waitFor(() => expect(fake.service.currentEmail).toHaveBeenCalled());
      await userEvent.type(screen.getByLabelText('Email'), 'scritta@example.com');
      await act(async () => {
        answerEmail.resolve('operatore@example.com');
        await Promise.resolve();
      });
      expect(screen.getByLabelText('Email')).toHaveValue('scritta@example.com');
    });
  });
});
