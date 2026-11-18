import { useId } from 'react';
import { Icon, type IconName } from '../../shared/ui/Icon';
import styles from './LedgerFailure.module.css';

/**
 * A write whose outcome is uncertain (wireframe "Spesa non salvata"): a raised panel with the
 * icon and the title in the danger tone, the explanation in ink. Its actions ("Annulla",
 * "Riprova +12") sit in the footer of the screen, as in the wireframe.
 */
export function LedgerFailure({
  title,
  text,
  icon = 'wifi-off',
}: {
  title: string;
  text: string;
  icon?: IconName;
}) {
  const titleId = useId();
  return (
    <section role="alert" aria-labelledby={titleId} className={styles.failure}>
      <div className={styles.heading}>
        <Icon name={icon} size={24} className={styles.icon} />
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
      </div>
      <p className={styles.text}>{text}</p>
    </section>
  );
}
