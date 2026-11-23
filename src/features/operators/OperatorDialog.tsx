import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Icon } from '../../shared/ui/Icon';
import { NOT_IN_DISPLAY } from '../cards/customerName';
import { useDevice } from '../identity/AuthProvider';
import type { Role } from '../identity/types';
import { AdminPinStep } from './AdminPinStep';
import styles from './OperatorDialog.module.css';
import { STATUS_LABEL } from './OperatorRow';
import {
  ADMIN_PIN_MISSING,
  GENERIC_ERROR,
  LAST_ADMIN_ERROR,
  RATE_LIMITED_ERROR,
  SELF_ERROR,
  notInvitedError,
} from './operatorTexts';
import { RoleFieldset } from './RoleFieldset';
import { useOperatorsService } from './OperatorsServiceProvider';
import type { CancelInviteResult, Operator, PinRefusal, ResendResult, RoleResult } from './types';

/** The PIN refusals stay in the PIN step; every other failure goes back to the confirmation. */
type RoleFailure = Exclude<RoleResult['status'], 'ok' | 'forbidden' | PinRefusal['status']>;
type ResendFailure = Exclude<ResendResult['status'], 'resent' | 'forbidden'>;
type CancelFailure = Exclude<CancelInviteResult['status'], 'cancelled' | 'forbidden'>;

/** SPEC-operators point 6: every error stays in the dialog. */
const ROLE_ERROR: Record<RoleFailure, (name: string) => string> = {
  'last-admin': () => LAST_ADMIN_ERROR,
  self: () => SELF_ERROR,
  'admin-from-device': () => ADMIN_PIN_MISSING,
  'no-account': () => GENERIC_ERROR,
  'not-found': () => GENERIC_ERROR,
  network: () => GENERIC_ERROR,
  unknown: () => GENERIC_ERROR,
};

const RESEND_ERROR: Record<ResendFailure, (name: string) => string> = {
  'not-invited': notInvitedError,
  self: () => SELF_ERROR,
  'rate-limited': () => RATE_LIMITED_ERROR,
  network: () => GENERIC_ERROR,
  unknown: () => GENERIC_ERROR,
};

const CANCEL_ERROR: Record<CancelFailure, (name: string) => string> = {
  'not-invited': notInvitedError,
  self: () => SELF_ERROR,
  network: () => GENERIC_ERROR,
  unknown: () => GENERIC_ERROR,
};

/** Refusals that mean the list on screen is stale: it is asked again behind the dialog. */
const STALE: ReadonlySet<string> = new Set(['no-account', 'not-found', 'not-invited']);

/** The second confirmations, in the same dialog (SPEC-operators point 2). */
const CONFIRM = {
  promote: {
    question: (name: string) => `Rendere ${name} amministratore?`,
    consequence: 'Potrà gestire operatori, premi, punti ed esportazioni e annullare i movimenti.',
    label: 'Rendi amministratore',
  },
  demote: {
    question: (name: string) => `Rendere ${name} operatore?`,
    consequence: 'Non vedrà più le impostazioni da amministratore.',
    label: 'Rendi operatore',
  },
  cancel: {
    question: (name: string) => `Annullare l’invito a ${name}?`,
    consequence: 'Il link già inviato smette di funzionare.',
    label: 'Annulla invito',
  },
} as const;

/** `pin`: on the till tablet, "Rendi amministratore" asks the cashier's PIN (Open Questions 11). */
type Step = 'manage' | keyof typeof CONFIRM | 'pin';
type Action = 'role' | 'resend' | 'cancel';

export type OperatorDialogProps = {
  /** The person as the list shows it now (the dialog follows the reloaded list). */
  operator: Operator;
  /** Done: the outcome for the live region; the page closes the dialog and reloads the list. */
  onDone: (operator: Operator, message: string) => void;
  /** A refusal that means the list is stale: the page asks it again. */
  onStale: () => void;
  /** `forbidden`: the role was lost or the account deactivated. */
  onForbidden: () => void;
  onClose: () => void;
};

function describeOperator(operator: Operator): string {
  return [operator.email, STATUS_LABEL[operator.status]].filter(Boolean).join(' · ');
}

/**
 * The dialog "{nome}" of the Operators screen (SPEC-operators point 2, "Gestione della persona";
 * not in the wireframe): the email and the state; for active and invited people the "Ruolo" with
 * "Salva ruolo" and its second confirmation; for invited people "Reinvia invito" and "Annulla
 * invito" (second confirmation). On a device (the till tablet) naming an admin asks, after the
 * second confirmation, the cashier's PIN in the same dialog (Open Questions 11): the PIN goes with
 * the change and is never kept. One request at a time; errors stay in the dialog, which can try
 * again. Mount it with a `key` per person: its choices start again each time it opens.
 */
export function OperatorDialog({
  operator,
  onDone,
  onStale,
  onForbidden,
  onClose,
}: OperatorDialogProps) {
  const service = useOperatorsService();
  const device = useDevice();
  const onDevice = device !== null;
  const [step, setStep] = useState<Step>('manage');
  const [role, setRole] = useState<Role>(operator.role);
  const [busy, setBusy] = useState<Action | null>(null);
  // Set synchronously, so a second tap in the same frame is ignored before `busy` renders.
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The button that opened the confirmation: it gets the focus back with "Lascia com’è" (a new
  // element by then: the step unmounted it).
  const returnTo = useRef<'save' | 'cancel' | null>(null);
  const resendNoteId = useId();
  const radioName = useId();
  const { name } = operator;

  const manageable = operator.status === 'active' || operator.status === 'invited';
  const invited = operator.status === 'invited';

  useEffect(() => {
    // The shell sets the first focus; this moves it between the steps.
    if (step === 'manage') {
      if (returnTo.current === null) return;
      (returnTo.current === 'cancel' ? cancelRef : saveRef).current?.focus();
      returnTo.current = null;
    } else if (step === 'cancel' || step === 'pin') {
      // A dangerous action starts on the safe choice; the PIN step too (the keys are for touch).
      closeRef.current?.focus();
    } else {
      confirmRef.current?.focus();
    }
  }, [step]);

  function goTo(next: Step, opener: 'save' | 'cancel' | null) {
    setError(null);
    if (next !== 'manage') returnTo.current = opener;
    setStep(next);
  }

  async function run<R extends { status: string }>(
    action: Action,
    call: () => Promise<R>,
    success: string,
    errors: Record<string, (name: string) => string>,
    message: string,
  ) {
    if (sending.current) return;
    sending.current = true;
    setBusy(action);
    setError(null);
    let result: { status: string };
    try {
      result = await call();
    } catch {
      // A server fault (`ServerFaultError`): "altro" in the table of point 6.
      result = { status: 'unknown' };
    }
    sending.current = false;
    setBusy(null);
    settle(result, success, errors, message);
  }

  function settle(
    result: { status: string },
    success: string,
    errors: Record<string, (name: string) => string>,
    message: string,
  ) {
    if (result.status === success) {
      onDone(operator, message);
    } else if (result.status === 'forbidden') {
      onForbidden();
    } else {
      setError((errors[result.status] ?? (() => GENERIC_ERROR))(name));
      if (STALE.has(result.status)) onStale();
    }
  }

  /**
   * The PIN step of "Rendi amministratore": a refused PIN stays there (PIN errato, the lock); any
   * other answer is settled as without the PIN, its error back in the confirmation.
   */
  async function promoteWithPin(pin: string): Promise<PinRefusal | null> {
    if (sending.current) return null;
    sending.current = true;
    setBusy('role');
    setError(null);
    let result: RoleResult;
    try {
      result = await service.setRole(operator.id, 'admin', pin);
    } catch {
      result = { status: 'unknown' };
    }
    sending.current = false;
    setBusy(null);
    if (result.status === 'wrong-pin' || result.status === 'pin-locked') return result;
    if (result.status !== 'ok' && result.status !== 'forbidden') setStep('promote');
    settle(result, 'ok', ROLE_ERROR, `${name} è ora amministratore.`);
    return null;
  }

  function close() {
    if (sending.current) return;
    if (step === 'manage') onClose();
    else goTo('manage', null);
  }

  const alert = error !== null && (
    <p role="alert" className={styles.error}>
      <Icon name="circle-alert" size={24} className={styles.errorIcon} />
      {error}
    </p>
  );

  let content;
  if (step === 'pin') {
    content = (
      <AdminPinStep
        question={`Per rendere ${name} amministratore dal tablet serve il tuo PIN.`}
        cashierName={device?.cashier?.name ?? ''}
        lockSeconds={device?.lockSecondsLeft ?? 0}
        onPin={promoteWithPin}
      />
    );
  } else if (step !== 'manage') {
    const texts = CONFIRM[step];
    content = (
      <>
        <p className={styles.question}>{texts.question(name)}</p>
        <p className={styles.consequence}>{texts.consequence}</p>
        {alert}
        <Button
          ref={confirmRef}
          variant={step === 'cancel' ? 'danger' : 'primary'}
          busy={busy !== null}
          block
          onClick={() => {
            if (step === 'promote' && onDevice) {
              goTo('pin', returnTo.current);
            } else if (step === 'cancel') {
              void run(
                'cancel',
                () => service.cancelInvite(operator.id),
                'cancelled',
                CANCEL_ERROR,
                `Invito a ${name} annullato.`,
              );
            } else {
              void run(
                'role',
                () => service.setRole(operator.id, step === 'promote' ? 'admin' : 'operator'),
                'ok',
                ROLE_ERROR,
                step === 'promote' ? `${name} è ora amministratore.` : `${name} è ora operatore.`,
              );
            }
          }}
        >
          {texts.label}
        </Button>
      </>
    );
  } else if (manageable) {
    content = (
      <>
        <RoleFieldset name={radioName} value={role} onChange={setRole} />
        <Button
          ref={saveRef}
          block
          disabled={role === operator.role}
          onClick={() => {
            if (!sending.current) goTo(role === 'admin' ? 'promote' : 'demote', 'save');
          }}
        >
          Salva ruolo
        </Button>
        {/* A resend refused because the person accepted meanwhile: the list now says active. */}
        {!invited && alert}
        {invited && (
          <div className={styles.invite}>
            <Button
              variant="secondary"
              block
              busy={busy === 'resend'}
              aria-describedby={resendNoteId}
              onClick={() =>
                void run(
                  'resend',
                  () => service.resendInvite(operator.id),
                  'resent',
                  RESEND_ERROR,
                  `Invito inviato di nuovo a ${name}.`,
                )
              }
            >
              Reinvia invito
            </Button>
            <p id={resendNoteId} className={styles.note}>
              Il link precedente smette di funzionare.
            </p>
            {alert}
            <Button
              ref={cancelRef}
              variant="danger-secondary"
              block
              onClick={() => {
                if (!sending.current) goTo('cancel', 'cancel');
              }}
            >
              Annulla invito
            </Button>
          </div>
        )}
      </>
    );
  } else {
    // Deactivated (or removed meanwhile): only the email and the state.
    content = alert || null;
  }

  return (
    <Dialog
      open
      title={
        <span className={styles.titleName} data-body-font={NOT_IN_DISPLAY.test(name)}>
          {name}
        </span>
      }
      description={describeOperator(operator)}
      closeLabel={step === 'manage' ? 'Chiudi' : 'Lascia com’è'}
      closeRef={closeRef}
      onClose={close}
    >
      {content}
    </Dialog>
  );
}
