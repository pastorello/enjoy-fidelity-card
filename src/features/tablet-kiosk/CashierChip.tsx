import { useRef, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { NOT_IN_DISPLAY } from '../cards/customerName';
import { useKioskService } from './KioskServiceProvider';
import styles from './CashierChip.module.css';

function initialOf(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase('it-IT');
}

/**
 * "Alla cassa: <nome> · Cambia" in the header of the till tablet (SPEC-tablet-kiosk, point 4;
 * wireframes "Tablet: …"). Tapping it ends the turn on the server (`end_cashier_turn`) and then
 * goes to /cassa, whatever the answer: when the call fails the client takes the turn as ended and
 * the next unlock replaces the cashier on the server. What was not confirmed is lost, as with
 * "Indietro". The service gives up after its own timeout, so the till is never stuck here.
 */
export function CashierChip({ name }: { name: string }) {
  const kiosk = useKioskService();
  const navigate = useNavigate();
  // A second tap while the turn is closing sends nothing more.
  const ending = useRef(false);

  function change(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (ending.current) return;
    ending.current = true;
    void kiosk
      .endTurn()
      .catch(() => undefined)
      .then(() => navigate('/cassa', { replace: true }));
  }

  return (
    <Link
      to="/cassa"
      onClick={change}
      className={styles.chip}
      data-body-font={NOT_IN_DISPLAY.test(name)}
    >
      <span aria-hidden="true" className={styles.initial}>
        {initialOf(name)}
      </span>
      {/* A long name cuts the name with an ellipsis, never "Cambia". In a narrow window only the
          initial and "Cambia" show; the link keeps its full name. */}
      <span className={styles.name}>Alla cassa: {name}</span>{' '}
      <span className={styles.change}>
        <span className={styles.separator}>·</span> Cambia
      </span>
    </Link>
  );
}
