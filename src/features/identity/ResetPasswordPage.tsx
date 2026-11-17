import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { ScreenTitle } from '../../shared/ui/ScreenTitle';
import { TextField } from '../../shared/ui/TextField';
import { useAuth, type RecoveryOutcome } from './AuthProvider';
import styles from './ResetPasswordPage.module.css';

const MIN_LENGTH = 8;
/** bcrypt in Supabase Auth counts bytes, not characters: "è" is 2. */
const MAX_BYTES = 72;
const TOO_SHORT = 'Almeno 8 caratteri.';

/** Server answers about the new password itself, shown under its field. */
type FieldOutcome = Extract<RecoveryOutcome, 'same-password' | 'weak'>;
/** Everything else that keeps the form on screen, shown above the button. */
type FailureOutcome = Exclude<
  RecoveryOutcome,
  'ok' | 'not-enabled' | 'invalid-link' | FieldOutcome
>;

const fieldMessages: Record<FieldOutcome, string> = {
  'same-password': 'La nuova password deve essere diversa da quella attuale.',
  weak: TOO_SHORT,
};

const failureMessages: Record<FailureOutcome, string> = {
  'verify-network': 'Connessione assente: riprova.',
  'verify-unknown': 'Non è stato possibile verificare il link. Riprova tra poco.',
  'save-network': 'Connessione assente: la password non è stata salvata. Riprova.',
  'save-unknown': 'Password non salvata. Riprova tra poco.',
};

type FieldErrors = { password?: string | undefined; repeat?: string | undefined };

function validate(password: string, repeat: string): FieldErrors {
  if (password.length < MIN_LENGTH) return { password: TOO_SHORT };
  if (new TextEncoder().encode(password).length > MAX_BYTES) {
    return { password: 'Password troppo lunga.' };
  }
  if (password !== repeat) return { repeat: 'Le password non coincidono.' };
  return {};
}

/** The token of a recovery link, or null when the link is missing or not a recovery one. */
function recoveryToken(search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  const tokenHash = params.get('type') === 'recovery' ? params.get('token_hash') : null;
  // An error in the fragment comes from Supabase's default template (used or expired link).
  if (!tokenHash || hash.includes('error')) return null;
  return tokenHash;
}

function Brand() {
  return (
    <div className={styles.brand}>
      <div aria-hidden="true" className={styles.logo} />
      <p className="visually-hidden">Bar Enjoy Gaeta</p>
    </div>
  );
}

/**
 * Wireframe "Invito: scegli la password", adapted to recovery: public page opened from the
 * email link. The token is consumed only when "Salva e accedi" is tapped, never on opening.
 */
export function ResetPasswordPage() {
  const { state, completeRecovery, abandonRecovery } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const tokenHash = recoveryToken(location.search, location.hash);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<FailureOutcome>();
  const [invalidLink, setInvalidLink] = useState(false);
  const [busy, setBusy] = useState(false);
  // A double tap reaches the handler twice before the busy state renders.
  const saving = useRef(false);

  // Leaving with a verified link but no saved password: the link never counts as a sign-in.
  useEffect(
    () => () => {
      void abandonRecovery();
    },
    [abandonRecovery],
  );

  if (!tokenHash || invalidLink) {
    return (
      <main className={styles.page}>
        <Brand />
        {/* Focus only when the view replaced the form after "Salva e accedi". */}
        <ScreenTitle focusOnMount={invalidLink}>Il link è scaduto o è già stato usato.</ScreenTitle>
        <ButtonLink to="/password-dimenticata" block className={styles.submit}>
          Chiedi un nuovo link
        </ButtonLink>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || !tokenHash) return;
    const errors = validate(password, repeat);
    setFieldErrors(errors);
    setFailure(undefined);
    if (errors.password || errors.repeat) return;

    saving.current = true;
    setBusy(true);
    let outcome: RecoveryOutcome;
    try {
      outcome = await completeRecovery(tokenHash, password);
    } catch {
      outcome = 'save-unknown';
    } finally {
      saving.current = false;
      setBusy(false);
    }

    if (outcome === 'ok') void navigate('/', { replace: true });
    else if (outcome === 'not-enabled') void navigate('/accedi', { replace: true });
    else if (outcome === 'invalid-link') setInvalidLink(true);
    else if (outcome === 'same-password' || outcome === 'weak') {
      setFieldErrors({ password: fieldMessages[outcome] });
    } else setFailure(outcome);
  }

  const signedInAs = state.status === 'signed-in' ? state.operator.name : undefined;
  const offline = failure === 'verify-network' || failure === 'save-network';

  return (
    <main className={styles.page}>
      <Brand />
      <ScreenTitle>Scegli una nuova password</ScreenTitle>
      <p className={styles.text}>Scegli la password per accedere all’Enjoy Card.</p>
      {signedInAs && (
        <output className={styles.notice}>
          <Icon name="circle-alert" size={20} />
          {`Sei collegato come ${signedInAs}: salvando, accederai con l’account del link.`}
        </output>
      )}
      <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
        <TextField
          label="Nuova password"
          type="password"
          value={password}
          onChange={setPassword}
          hint={TOO_SHORT}
          error={fieldErrors.password}
          autoComplete="new-password"
        />
        <TextField
          label="Ripeti la password"
          type="password"
          value={repeat}
          onChange={setRepeat}
          error={fieldErrors.repeat}
          autoComplete="new-password"
        />
        {failure && (
          <p role="alert" className={styles.failure}>
            <Icon name={offline ? 'wifi-off' : 'circle-alert'} size={20} />
            {failureMessages[failure]}
          </p>
        )}
        <Button type="submit" block busy={busy} className={styles.submit}>
          Salva e accedi
        </Button>
      </form>
    </main>
  );
}
