import { Link } from 'react-router';
import { Icon } from '../../shared/ui/Icon';
import styles from './NewCustomerCardPanel.module.css';

/**
 * "Card letta" of Nuovo cliente from a new card (SPEC-cards, point 2; wireframe "Card sconosciuta:
 * nuovo cliente"): the card read belongs to nobody and will be given to this customer. `uid` is the
 * canonical uid, shown in full.
 */
export function NewCustomerCardPanel({ uid }: { uid: string }) {
  return (
    <section aria-label="Card letta" className={styles.panel}>
      <span className={styles.badge}>
        <Icon name="check" size={18} />
      </span>
      <div className={styles.texts}>
        <p className={styles.title}>Card nuova letta</p>
        <p className={styles.text}>
          Codice {uid}: non è di nessun cliente, verrà associata a questo.
        </p>
      </div>
    </section>
  );
}

/** Under the form: a card read by mistake for a customer already registered goes from their page. */
export function RegisteredCustomerHint() {
  return (
    <p className={styles.hint}>
      È la nuova card di un cliente già registrato? <Link to="/">Cerca il cliente</Link> e associa
      la card dalla sua scheda.
    </p>
  );
}
