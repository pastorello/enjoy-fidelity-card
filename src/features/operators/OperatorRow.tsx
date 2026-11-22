import { useEffect, useId, useRef } from 'react';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { NOT_IN_DISPLAY } from '../cards/customerName';
import { useDevice } from '../identity/AuthProvider';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import { ADMIN_REACTIVATE_FROM_PHONE } from './operatorTexts';
import styles from './OperatorRow.module.css';
import type { Operator, OperatorStatus } from './types';

const ROLE_LABEL = { admin: 'Amministratore', operator: 'Operatore' } as const;

/** SPEC-operators point 2, table of the states: `removed` reads as `deactivated`. */
export const STATUS_LABEL: Record<OperatorStatus, string> = {
  active: 'attivo',
  invited: 'invito inviato',
  deactivated: 'disattivato, movimenti nello storico',
  removed: 'disattivato, movimenti nello storico',
};

/** Deactivated and removed people: the dashed circle and the grey text of the wireframe. */
function isAway(operator: Operator): boolean {
  return operator.status === 'deactivated' || operator.status === 'removed';
}

/** "Amministratore · attivo"; on the tablet layout the PIN too, for active and invited people. */
function statusText(operator: Operator, tablet: boolean): string {
  const text = `${ROLE_LABEL[operator.role]} · ${STATUS_LABEL[operator.status]}`;
  if (!tablet || isAway(operator)) return text;
  return `${text} · ${operator.hasPin ? 'PIN impostato' : 'PIN da impostare'}`;
}

/** The first character of the name (a whole code point), uppercase: Enjoy Display has no lowercase. */
function initialOf(name: string): string {
  return (Array.from(name.trim())[0] ?? '').toLocaleUpperCase('it-IT');
}

/**
 * The row's action (SPEC-operators point 2): "Disattiva" for active and invited people,
 * "Riattiva" for deactivated ones; none for removed people (no account) and for the own row.
 * From the till (`fromTill`: the tablet layout or a device account) a deactivated admin has none
 * either: an admin is reactivated from the phone (point 7, EO005).
 */
export type RowAction = 'deactivate' | 'reactivate';

/** A deactivated admin seen from the till: no "Riattiva", the note instead. */
export function reactivatesFromPhone(operator: Operator, fromTill: boolean): boolean {
  return fromTill && operator.status === 'deactivated' && operator.role === 'admin';
}

export function rowActionOf(operator: Operator, fromTill = false): RowAction | null {
  if (operator.isMe) return null;
  if (operator.status === 'deactivated') {
    return reactivatesFromPhone(operator, fromTill) ? null : 'reactivate';
  }
  if (operator.status === 'removed') return null;
  return 'deactivate';
}

/** Who opens the person dialog: active, invited and deactivated people, never the own row. */
export function opensDialog(operator: Operator): boolean {
  return !operator.isMe && operator.status !== 'removed';
}

/** Which control of the row takes the focus: its action button, or the person button. */
export type RowFocus = 'action' | 'person';

type OperatorRowProps = {
  operator: Operator;
  /** "Disattiva" or "Riattiva" was tapped: the page asks for the confirmation. */
  onAction: (operator: Operator, action: RowAction) => void;
  /** The name was tapped: the page opens the dialog "{nome}". */
  onOpen: (operator: Operator) => void;
  /**
   * The row of the last action done: that control (or the row, when it has none any more) takes
   * the focus, again each time the reloaded list changes its state.
   */
  focus?: RowFocus | undefined;
};

/**
 * One person of the Operators screen (wireframe "Operatori"): the initial in the circle (dashed and
 * grey for deactivated and removed people), the name with "(tu)" for the person acting, and
 * "ruolo · stato" under it (a button with a chevron that opens the dialog "{nome}"), then
 * "Disattiva" or "Riattiva". The own row has no action and is not tappable; a removed row has no
 * button.
 */
export function OperatorRow({ operator, onAction, onOpen, focus }: OperatorRowProps) {
  const tablet = useTabletLayout();
  const device = useDevice();
  const fromTill = tablet || device !== null;
  const nameId = useId();
  const actionRef = useRef<HTMLButtonElement>(null);
  const personRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  const action = rowActionOf(operator, fromTill);
  const opens = opensDialog(operator);
  const initial = initialOf(operator.name);
  const away = isAway(operator) ? 'true' : undefined;
  useEffect(() => {
    if (focus === undefined) return;
    // After the dialog returned the focus to the opener, and again once the reloaded row changes
    // (it may have moved in the list): the control asked for, or the row when it has none.
    const shown = focus === 'action' ? action !== null : opens;
    const control = focus === 'action' ? actionRef.current : personRef.current;
    (shown ? control : itemRef.current)?.focus();
  }, [focus, action, opens]);

  const text = (
    <span className={styles.text}>
      <span id={nameId} className={styles.name} data-operator-name>
        {operator.isMe ? `${operator.name} (tu)` : operator.name}
      </span>{' '}
      <span className={styles.status}>{statusText(operator, tablet)}</span>
      {reactivatesFromPhone(operator, fromTill) && (
        <span className={styles.status}>{ADMIN_REACTIVATE_FROM_PHONE}</span>
      )}
    </span>
  );

  return (
    <li
      ref={itemRef}
      tabIndex={focus === undefined ? undefined : -1}
      className={styles.item}
      data-away={away}
    >
      <span
        className={styles.initial}
        aria-hidden="true"
        data-initial
        data-away={away}
        data-body-font={NOT_IN_DISPLAY.test(initial)}
      >
        {initial}
      </span>
      {opens ? (
        // Like ListRow: the name and the state are the target, with the chevron.
        <button
          ref={personRef}
          type="button"
          className={styles.person}
          onClick={() => onOpen(operator)}
        >
          {text}
          <Icon name="chevron-right" size={20} className={styles.chevron} />
        </button>
      ) : (
        text
      )}
      {action !== null && (
        <Button
          ref={actionRef}
          // The wireframe's outlined red button; "Riattiva" (not in the wireframe) is secondary.
          variant={action === 'deactivate' ? 'danger-secondary' : 'secondary'}
          className={styles.action}
          aria-describedby={nameId}
          onClick={() => onAction(operator, action)}
        >
          {action === 'deactivate' ? 'Disattiva' : 'Riattiva'}
        </Button>
      )}
    </li>
  );
}
