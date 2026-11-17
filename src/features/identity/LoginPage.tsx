import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { ScreenTitle } from '../../shared/ui/ScreenTitle';
import { StatusView } from '../../shared/ui/StatusView';
import { TextField } from '../../shared/ui/TextField';
import { useAuth, type SignInOutcome } from './AuthProvider';
import type { SignedOutReason } from './types';
import styles from './LoginPage.module.css';

const NOT_ENABLED = 'Account non abilitato: chiedi a un amministratore.';

const failureMessages: Record<Exclude<SignInOutcome, 'ok'>, string> = {
  invalid: 'Email o password non corretti.',
  network: 'Connessione assente: controlla la rete e riprova.',
  'rate-limited': 'Troppi tentativi. Aspetta qualche minuto e riprova.',
  unknown: 'Accesso non riuscito. Riprova tra poco.',
  'not-enabled': NOT_ENABLED,
  misconfigured: 'Servizio non configurato: chiedi a un amministratore.',
  unavailable: 'Servizio momentaneamente non disponibile: riprova tra poco.',
};

const reasonMessages: Record<SignedOutReason, string> = {
  expired: 'La sessione è scaduta: accedi di nuovo.',
  'not-enabled': NOT_ENABLED,
};

/** Only same-app paths: never a full URL taken from the history state. */
function returnPath(state: unknown): string {
  const from: unknown =
    typeof state === 'object' && state !== null && 'from' in state ? state.from : undefined;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

type FieldErrors = { email?: string | undefined; password?: string | undefined };

export function LoginPage() {
  const { state, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (state.status === 'signed-in') {
    return <Navigate to={returnPath(location.state)} replace />;
  }
  if (state.status === 'loading') {
    return (
      <div className={styles.page}>
        <StatusView kind="loading" />
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const errors: FieldErrors = {
      email: email.trim() ? undefined : 'Inserisci l’email',
      password: password ? undefined : 'Inserisci la password',
    };
    setFieldErrors(errors);
    setFailure(undefined);
    if (errors.email || errors.password) return;

    setBusy(true);
    let outcome: SignInOutcome;
    try {
      outcome = await signIn(email.trim(), password);
    } catch {
      outcome = 'unknown';
    } finally {
      setBusy(false);
    }
    if (outcome !== 'ok') {
      setFailure(failureMessages[outcome]);
      if (outcome === 'invalid') setPassword('');
    }
  }

  const reason = state.status === 'signed-out' ? state.reason : undefined;

  return (
    <main className={styles.page}>
      <div className={styles.brand}>
        <div aria-hidden="true" className={styles.logo} />
        <p className="visually-hidden">Enjoy Card</p>
      </div>
      <ScreenTitle>Accedi</ScreenTitle>
      {reason && !failure && (
        <output className={styles.notice}>
          <Icon name="circle-alert" size={20} />
          {reasonMessages[reason]}
        </output>
      )}
      <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="nome@esempio.it"
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          autoComplete="current-password"
        />
        {failure && (
          <p role="alert" className={styles.failure}>
            <Icon name="circle-alert" size={20} />
            {failure}
          </p>
        )}
        <Button type="submit" block busy={busy} className={styles.submit}>
          Accedi
        </Button>
      </form>
      <Link to="/password-dimenticata" className={styles.forgot}>
        Password dimenticata?
      </Link>
      <p className={styles.note}>
        Gli account li crea un amministratore: se non riesci ad accedere, rivolgiti a chi gestisce
        l’app.
      </p>
    </main>
  );
}
