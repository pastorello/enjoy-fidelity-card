import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { ScreenTitle } from '../../shared/ui/ScreenTitle';
import { TextField } from '../../shared/ui/TextField';
import { NOT_IN_DISPLAY } from '../cards/customerName';
import { INVITE_NAME_MAX } from '../operators/validateInvite';
import { useAuth, type LinkKind, type RecoveryOutcome } from './AuthProvider';
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

/** What the URL says: which link opened the page, and its token (null when unusable). */
type Link = { kind: LinkKind; tokenHash: string | null; fragment: URLSearchParams };

function readLink(search: string, hash: string): Link {
  const params = new URLSearchParams(search);
  const type = params.get('type');
  const kind: LinkKind = type === 'invite' ? 'invite' : 'recovery';
  const fragment = new URLSearchParams(hash.slice(1));
  // Supabase's default template reports a used or expired link with these keys in the fragment;
  // the invite's names travel there too, so "Terrore" in a name is not an error.
  const failed = fragment.has('error') || fragment.has('error_code');
  const tokenHash = type === kind && !failed ? params.get('token_hash') : null;
  return { kind, tokenHash: tokenHash || null, fragment };
}

/** The `role_label` of the invite email (operator-invites). */
const ROLES = new Set(['operatore', 'amministratore']);

/** A name of the fragment, trimmed, when it has 1 to 60 characters (code points, as Postgres). */
function fragmentName(fragment: URLSearchParams, key: string): string | null {
  const value = fragment.get(key)?.trim() ?? '';
  const length = Array.from(value).length;
  return length >= 1 && length <= INVITE_NAME_MAX ? value : null;
}

/**
 * The invite's texts from the fragment (never sent to the server). Display text only: when any
 * value is missing or not valid, the page uses the generic texts.
 */
function inviteTexts(fragment: URLSearchParams) {
  const name = fragmentName(fragment, 'nome');
  const by = fragmentName(fragment, 'da');
  const role = fragment.get('ruolo');
  if (!name || !by || !role || !ROLES.has(role)) return null;
  return { name, by, role };
}

function Brand() {
  return (
    <div className={styles.brand}>
      <div aria-hidden="true" className={styles.logo} />
      <p className="visually-hidden">Bar Enjoy Gaeta</p>
    </div>
  );
}

/** The page's title and text: the recovery's, the invite's from the fragment, or the generic invite's. */
function Intro({ kind, fragment }: Pick<Link, 'kind' | 'fragment'>) {
  if (kind === 'recovery') {
    return (
      <>
        <ScreenTitle>Scegli una nuova password</ScreenTitle>
        <p className={styles.text}>Scegli la password per accedere all’Enjoy Card.</p>
      </>
    );
  }
  const invite = inviteTexts(fragment);
  if (!invite) {
    return (
      <>
        <ScreenTitle>Scegli la password</ScreenTitle>
        <p className={styles.text}>
          Sei stato invitato all’Enjoy Card. Scegli la password per accedere.
        </p>
      </>
    );
  }
  return (
    <>
      <ScreenTitle>
        Ciao, {/* A name with a glyph Enjoy Display lacks is set in the body font. */}
        <span className={styles.titleName} data-body-font={NOT_IN_DISPLAY.test(invite.name)}>
          {invite.name}
        </span>
      </ScreenTitle>
      <p className={styles.text}>
        {`${invite.by} ti ha invitato come ${invite.role} dell’Enjoy Card. Scegli la password per accedere.`}
      </p>
    </>
  );
}

/**
 * Wireframe "Invito: scegli la password": public page opened from the email link, in its invite
 * version (`type=invite`, SPEC-operators point 4) or adapted to recovery. The token is consumed
 * only when "Salva e accedi" is tapped, never on opening.
 */
export function ResetPasswordPage() {
  const { state, completeRecovery, abandonRecovery } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { kind, tokenHash, fragment } = readLink(location.search, location.hash);
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
        {kind === 'invite' ? (
          <>
            {/* "Password dimenticata" cannot help an invite never accepted. */}
            <p className={styles.text}>Chiedi a chi ti ha invitato di mandarti un nuovo invito.</p>
            <ButtonLink to="/accedi" block className={styles.submit}>
              Vai all’accesso
            </ButtonLink>
          </>
        ) : (
          <ButtonLink to="/password-dimenticata" block className={styles.submit}>
            Chiedi un nuovo link
          </ButtonLink>
        )}
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
      outcome = await completeRecovery(tokenHash, password, kind);
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
      <Intro kind={kind} fragment={fragment} />
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
