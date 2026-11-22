import { useId, useRef, useState, type FormEvent } from 'react';
import { useLatest } from '../../lib/useLatest';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { TextField } from '../../shared/ui/TextField';
import { useDevice } from '../identity/AuthProvider';
import type { Role } from '../identity/types';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import styles from './InviteForm.module.css';
import {
  ADMIN_FROM_PHONE,
  ADMIN_INVITE_FROM_PHONE,
  EMAIL_DEACTIVATED_ERROR,
  EMAIL_IS_DEVICE_ERROR,
  EMAIL_TAKEN_ERROR,
  GENERIC_ERROR,
  IN_PROGRESS_ERROR,
  INVITE_NETWORK_ERROR,
  NAME_TAKEN_ERROR,
  RATE_LIMITED_ERROR,
} from './operatorTexts';
import { useOperatorsService } from './OperatorsServiceProvider';
import { RoleFieldset } from './RoleFieldset';
import type { InviteResult, OperatorBrief } from './types';
import { validateInvite, type InviteFormValues } from './validateInvite';

/** The note under "Invia invito" (SPEC-operators point 3); the tablet names the till PIN too. */
const NOTE = 'Riceverà un’email per scegliere la password.';
const TABLET_NOTE =
  'Riceverà un’email per scegliere la password; il PIN per il tablet lo imposta dal proprio telefono.';

const EMPTY: InviteFormValues = { name: '', email: '', role: 'operator' };

/** Failures told under "Invia invito" (SPEC-operators point 6); `upstream` and the rest: generic. */
type ButtonFailure = 'rate-limited' | 'in-progress' | 'network' | 'unknown';

const BUTTON_ERROR: Record<ButtonFailure, string> = {
  'rate-limited': RATE_LIMITED_ERROR,
  'in-progress': IN_PROGRESS_ERROR,
  network: INVITE_NETWORK_ERROR,
  unknown: GENERIC_ERROR,
};

type FieldErrors = {
  name?: string | undefined;
  email?: string | undefined;
  role?: string | undefined;
};

/**
 * The `operation_id` of the invite and what it was first sent with (null: not sent yet). The
 * server refuses the same id with other values (22023), and a new tap after no answer must reuse
 * it: so it is kept while the values sent stay the same and made again when they change.
 */
type Operation = { id: string; sentWith: string | null };

/** What the server compares: the cleaned name, the email as it stores it, the role. */
function sentKey(invite: InviteFormValues): string {
  return JSON.stringify([invite.name, invite.email.toLowerCase(), invite.role]);
}

export type InviteFormProps = {
  /** While the list loads. */
  disabled: boolean;
  /** Sent: the page says "Invito inviato a {nome}." and asks the list again. */
  onInvited: (operator: OperatorBrief) => void;
  /** `forbidden`: the role was lost or the account deactivated. */
  onForbidden: () => void;
};

/**
 * "Invita operatore" at the bottom of the Operators screen (wireframe "Operatori", SPEC-operators
 * point 3): Nome, Email, Ruolo ("Operatore" by default), "Invia invito" and the note. The app
 * checks the values first (`validateInvite`): a wrong form costs no call, its messages go under
 * the fields and the focus to the first wrong one. The `operation_id` is made when the form opens
 * and after each invite sent, and kept while the values sent do not change, so a new tap after
 * no answer sends one email at most. The button is busy until the answer (a double tap sends
 * once). The refusals of point 6 go under the field they concern, or under the button; `forbidden`
 * goes to the page. Sent: the form empties (the role back to "Operatore").
 *
 * On the tablet layout the page puts it in the `<aside aria-label="Invita operatore">` column, so
 * it is a plain block there (no second landmark of the same name), and "Amministratore" cannot be
 * chosen (Open Questions 11): the same rule as the person dialog, also for a device without the
 * tablet layout. The server refuses an admin from a device anyway (`admin_from_device`).
 */
export function InviteForm({ disabled, onInvited, onForbidden }: InviteFormProps) {
  const service = useOperatorsService();
  const tablet = useTabletLayout();
  const onDevice = useDevice() !== null;
  const adminDisabled = tablet || onDevice;
  const [values, setValues] = useState<InviteFormValues>(EMPTY);
  // Read by the submit handler: the values the screen shows, even right after a commit.
  const latestValues = useLatest(values);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ButtonFailure | null>(null);
  const [busy, setBusy] = useState(false);
  // Set synchronously, so a second tap in the same frame is ignored before `busy` renders.
  const sending = useRef(false);
  const [firstId] = useState(() => crypto.randomUUID());
  const operation = useRef<Operation>({ id: firstId, sentWith: null });
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const noteId = useId();
  const roleName = useId();

  function change(key: 'name' | 'email', value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function changeRole(role: Role) {
    setValues((current) => ({ ...current, role }));
    setErrors((current) => ({ ...current, role: undefined }));
  }

  /** The operation for `invite`: the same id while the values sent are the same. */
  function operationFor(invite: InviteFormValues): string {
    const key = sentKey(invite);
    if (operation.current.sentWith !== null && operation.current.sentWith !== key) {
      operation.current = { id: crypto.randomUUID(), sentWith: null };
    }
    operation.current.sentWith = key;
    return operation.current.id;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const checked = validateInvite(latestValues.current);
    if (!checked.ok) {
      setErrors(checked.errors);
      setFailure(null);
      (checked.errors.name !== undefined ? nameRef : emailRef).current?.focus();
      return;
    }
    const { invite } = checked;
    const operationId = operationFor(invite);
    setErrors({});
    setFailure(null);
    sending.current = true;
    setBusy(true);
    let result: InviteResult;
    try {
      result = await service.invite({ operationId, ...invite });
    } catch {
      // A server fault (`ServerFaultError`): "altro" in the table of point 6.
      result = { status: 'unknown' };
    }
    sending.current = false;
    setBusy(false);

    switch (result.status) {
      case 'invited':
        operation.current = { id: crypto.randomUUID(), sentWith: null };
        setValues(EMPTY);
        onInvited(result.operator);
        return;
      case 'forbidden':
        onForbidden();
        return;
      case 'name-taken':
        setErrors({ name: NAME_TAKEN_ERROR });
        nameRef.current?.focus();
        return;
      case 'email-taken':
        setErrors({ email: result.deactivated ? EMAIL_DEACTIVATED_ERROR : EMAIL_TAKEN_ERROR });
        emailRef.current?.focus();
        return;
      case 'email-is-device':
        setErrors({ email: EMAIL_IS_DEVICE_ERROR });
        emailRef.current?.focus();
        return;
      case 'admin-from-device':
        setErrors({ role: ADMIN_FROM_PHONE });
        return;
      default:
        // No answer: the same operation_id goes with the next tap, unless the values change.
        setFailure(result.status);
    }
  }

  const Box = tablet ? 'div' : 'section';
  return (
    <Box aria-labelledby={tablet ? undefined : headingId} className={styles.box}>
      <h2 id={headingId} className={styles.title}>
        Invita operatore
      </h2>
      <form noValidate onSubmit={(event) => void handleSubmit(event)}>
        <fieldset disabled={disabled} className={styles.fields}>
          <TextField
            ref={nameRef}
            label="Nome"
            placeholder="Es. Marco"
            value={values.name}
            onChange={(value) => change('name', value)}
            error={errors.name}
            autoComplete="off"
            autoCapitalize="words"
          />
          <TextField
            ref={emailRef}
            label="Email"
            type="email"
            inputMode="email"
            placeholder="nome@esempio.it"
            value={values.email}
            onChange={(value) => change('email', value)}
            error={errors.email}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <RoleFieldset
            name={roleName}
            value={values.role}
            onChange={changeRole}
            adminDisabled={adminDisabled}
            note={adminDisabled ? ADMIN_INVITE_FROM_PHONE : undefined}
            error={errors.role}
          />
          <Button type="submit" block busy={busy} aria-describedby={noteId}>
            Invia invito
          </Button>
          {failure && (
            <p role="alert" className={styles.failure}>
              <Icon name={failure === 'network' ? 'wifi-off' : 'circle-alert'} size={20} />
              {BUTTON_ERROR[failure]}
            </p>
          )}
          <p id={noteId} className={styles.note}>
            {tablet ? TABLET_NOTE : NOTE}
          </p>
        </fieldset>
      </form>
    </Box>
  );
}
