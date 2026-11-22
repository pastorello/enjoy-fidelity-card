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
 * One person of the Operators screen (wireframe "Operatori"): the initial in the circle (dashed and
 * grey for deactivated and removed people), the name with "(tu)" for the person acting, and
 * "ruolo · stato" under it. The own row has no action and is not tappable.
 */
export function OperatorRow({ operator }: { operator: Operator }) {
  const tablet = useTabletLayout();
  const initial = initialOf(operator.name);
  const away = isAway(operator) ? 'true' : undefined;
  return (
    <li className={styles.item} data-away={away}>
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
        <span className={styles.name} data-operator-name>
          {operator.isMe ? `${operator.name} (tu)` : operator.name}
        </span>
        <span className={styles.status}>{statusText(operator, tablet)}</span>
      </span>
    </li>
  );
}
