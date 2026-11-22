import { useEffect, useId, useRef } from 'react';
import { Button } from '../../shared/ui/Button';
import { NOT_IN_DISPLAY } from '../cards/customerName';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import styles from './OperatorRow.module.css';
import type { Operator, OperatorStatus } from './types';

const ROLE_LABEL = { admin: 'Amministratore', operator: 'Operatore' } as const;

/** SPEC-operators point 2, table of the states: `removed` reads as `deactivated`. */
const STATUS_LABEL: Record<OperatorStatus, string> = {
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
 */
export type RowAction = 'deactivate' | 'reactivate';

export function rowActionOf(operator: Operator): RowAction | null {
  if (operator.isMe) return null;
  if (operator.status === 'deactivated') return 'reactivate';
  if (operator.status === 'removed') return null;
  return 'deactivate';
}

type OperatorRowProps = {
  operator: Operator;
  /** "Disattiva" or "Riattiva" was tapped: the page asks for the confirmation. */
  onAction: (operator: Operator, action: RowAction) => void;
  /**
   * The row of the last action done: its button (or the row, when it has none any more) takes the
   * focus, again each time the reloaded list changes its state.
   */
  focused?: boolean;
};

/**
 * One person of the Operators screen (wireframe "Operatori"): the initial in the circle (dashed and
 * grey for deactivated and removed people), the name with "(tu)" for the person acting, and
 * "ruolo · stato" under it, then "Disattiva" or "Riattiva". The own row has no action and is not
 * tappable.
 */
export function OperatorRow({ operator, onAction, focused = false }: OperatorRowProps) {
  const tablet = useTabletLayout();
  const nameId = useId();
  const actionRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  const action = rowActionOf(operator);
  const initial = initialOf(operator.name);
  const away = isAway(operator) ? 'true' : undefined;
  useEffect(() => {
    if (!focused) return;
    // After the dialog returned the focus to the opener, and again once the reloaded row changes
    // its action (it may have moved in the list): its button, or the row when it has none.
    (action === null ? itemRef.current : actionRef.current)?.focus();
  }, [focused, action]);

  return (
    <li ref={itemRef} tabIndex={focused ? -1 : undefined} className={styles.item} data-away={away}>
      <span
        className={styles.initial}
        aria-hidden="true"
        data-initial
        data-away={away}
        data-body-font={NOT_IN_DISPLAY.test(initial)}
      >
        {initial}
      </span>
      <span className={styles.text}>
        <span id={nameId} className={styles.name} data-operator-name>
          {operator.isMe ? `${operator.name} (tu)` : operator.name}
        </span>
        <span className={styles.status}>{statusText(operator, tablet)}</span>
      </span>
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
