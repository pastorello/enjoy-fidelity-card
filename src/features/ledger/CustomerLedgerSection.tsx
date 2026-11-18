import { Link } from 'react-router';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { ListRow } from '../../shared/ui/ListRow';
import type { CustomerSummary } from '../customers/types';
import styles from './CustomerLedgerSection.module.css';
import { formatMovementDate, formatSignedPoints, movementLabel } from './formatMovement';
import type { Movement } from './types';
import { useMovements } from './useMovements';

/** How many movements the customer's page shows (wireframe Scheda cliente). */
const LAST_MOVEMENTS = 4;

/** "Ieri 19:10 · Giulia", with "· annullata" when a correction cancelled it. */
function movementLine(movement: Movement): string {
  const line = `${formatMovementDate(movement.createdAt)} · ${movement.operatorName}`;
  return movement.cancelledById === null ? line : `${line} · annullata`;
}

/** The newest movements, the empty text or the compact error row. Nothing while loading. */
function LastMovementsBody({ customerId }: { customerId: string }) {
  const load = useMovements(customerId, LAST_MOVEMENTS);
  if (load.status === 'loading') return null;
  if (load.status === 'error') {
    return (
      <div role="alert" className={styles.error}>
        <p className={styles.errorText}>
          <Icon name="circle-alert" size={20} />
          Non riesco a caricare i movimenti
        </p>
        <Button variant="secondary" busy={load.retrying} onClick={load.retry}>
          Riprova
        </Button>
      </div>
    );
  }
  if (load.movements.length === 0) {
    return <p className={styles.empty}>Ancora nessun movimento</p>;
  }
  return (
    <ul className={styles.list}>
      {load.movements.map((movement) => (
        <ListRow
          key={movement.id}
          title={movementLabel(movement)}
          subtitle={movementLine(movement)}
          trailing={<span className={styles.points}>{formatSignedPoints(movement.points)}</span>}
        />
      ))}
    </ul>
  );
}

/**
 * The ledger part of the Scheda cliente (SPEC-ledger point 8), mounted below the SALDO block:
 * "Registra spesa" and "Riscatta premio" (not for an erased customer), then ULTIMI MOVIMENTI with
 * the 4 newest movements (rows that are not interactive) and "Vedi tutti" to Movimenti.
 */
export function CustomerLedgerSection({ customer }: { customer: CustomerSummary }) {
  const erased = customer.anonymizedAt !== null;
  return (
    <>
      {!erased && (
        <div className={styles.actions}>
          <ButtonLink to={`/clienti/${customer.id}/spesa`} block>
            Registra spesa
          </ButtonLink>
          <ButtonLink to={`/clienti/${customer.id}/premi`} variant="secondary" block>
            Riscatta premio
          </ButtonLink>
        </div>
      )}
      <section aria-labelledby="last-movements" className={styles.section}>
        <div className={styles.header}>
          <h2 id="last-movements" className={styles.title}>
            ULTIMI MOVIMENTI
          </h2>
          <Link to={`/clienti/${customer.id}/movimenti`} className={styles.all}>
            Vedi tutti
          </Link>
        </div>
        <LastMovementsBody customerId={customer.id} />
      </section>
    </>
  );
}
