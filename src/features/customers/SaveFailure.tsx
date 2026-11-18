import { Icon } from '../../shared/ui/Icon';
import styles from './SaveFailure.module.css';

/**
 * "Cliente non salvato…" / "Modifiche non salvate…" (wireframe Errore rete): what went wrong
 * outside the fields, after the form of Nuovo cliente and Modifica cliente.
 */
export function SaveFailure({ text }: { text: string }) {
  return (
    <p role="alert" className={styles.failure}>
      <Icon name="circle-alert" size={24} className={styles.failureIcon} />
      {text}
    </p>
  );
}
