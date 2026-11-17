import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AppShell } from '../../app/AppShell';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { TextField } from '../../shared/ui/TextField';
import { useAuth } from './AuthProvider';
import styles from './ForgotPasswordPage.module.css';

const NETWORK = 'Connessione assente: controlla la rete e riprova.';

/** Local shape check only (`x@y`): the server decides whether the account exists. */
function emailError(email: string): string | undefined {
  if (!email) return 'Inserisci l’email';
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return 'Email non valida';
  return undefined;
}

/**
 * Wireframe "Password dimenticata". Public page; when signed in ("Cambia password" from the
 * settings) the email comes from the saved session, never from the URL. Every server answer
 * shows the same confirmation, so the page never reveals whether an account exists.
 */
export function ForgotPasswordPage() {
  const { state, currentEmail, requestPasswordReset } = useAuth();
  const signedIn = state.status === 'signed-in';
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // A double tap reaches the handler twice before the busy state renders.
  const sending = useRef(false);
  // The form, focused button included, leaves the page: focus moves to the confirmation so a
  // screen reader reads it (a live region mounted with its text is not reliably announced).
  const confirmation = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (sent) confirmation.current?.focus();
  }, [sent]);

  useEffect(() => {
    let active = true;
    if (!signedIn) return () => {};
    currentEmail().then(
      (saved) => {
        // Never overwrite what the user has already typed.
        if (active && saved) setEmail((typed) => (typed === '' ? saved : typed));
      },
      () => {}, // No prefill: the field stays empty and editable.
    );
    return () => {
      active = false;
    };
  }, [signedIn, currentEmail]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const trimmed = email.trim();
    const error = emailError(trimmed);
    setFieldError(error);
    setOffline(false);
    if (error) return;

    sending.current = true;
    setBusy(true);
    let result;
    try {
      // The return page is the app's own, never built from the input.
      result = await requestPasswordReset(trimmed, `${window.location.origin}/imposta-password`);
    } catch {
      result = 'network' as const;
    } finally {
      sending.current = false;
      setBusy(false);
    }
    if (result === 'sent') setSent(true);
    else setOffline(true);
  }

  const backTo = signedIn ? '/impostazioni' : '/accedi';

  return (
    <AppShell title="Password dimenticata" backTo={backTo}>
      {sent ? (
        <section className={styles.sent}>
          <span aria-hidden="true" className={styles.sentIcon}>
            <Icon name="check" size={32} />
          </span>
          <p ref={confirmation} tabIndex={-1} className={styles.text}>
            Se l’email è di un account dell’Enjoy Card, ti abbiamo mandato un link. Il link vale
            un’ora: se non arriva, controlla lo spam o chiedi a un amministratore.
          </p>
          <ButtonLink to={backTo} block>
            {signedIn ? 'Torna alle impostazioni' : 'Torna all’accesso'}
          </ButtonLink>
        </section>
      ) : (
        <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
          <p className={styles.text}>
            Scrivi l’email del tuo account: ti mandiamo un link per sceglierne una nuova.
          </p>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            error={fieldError}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="nome@esempio.it"
          />
          {offline && (
            <p role="alert" className={styles.failure}>
              <Icon name="wifi-off" size={20} />
              {NETWORK}
            </p>
          )}
          <Button type="submit" block busy={busy}>
            Invia il link
          </Button>
          <p className={styles.note}>
            Il link vale un’ora. Se non arriva, controlla lo spam o chiedi a un amministratore.
          </p>
        </form>
      )}
    </AppShell>
  );
}
