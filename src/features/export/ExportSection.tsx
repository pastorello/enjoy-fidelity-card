import { Button } from '../../shared/ui/Button';
import { useCurrentOperator } from '../identity/AuthProvider';
import styles from './ExportSection.module.css';

/**
 * ESPORTA DATI section of /impostazioni (wireframe "Impostazioni", SPEC-export point 1): the last
 * section, administrators only. Hiding it is a convenience: the export functions refuse operators on
 * the server. The live region below the buttons announces the export states.
 */
export function ExportSection() {
  const operator = useCurrentOperator();
  if (operator.role !== 'admin') return null;
  return (
    <section aria-labelledby="settings-export" className={styles.section}>
      <h2 id="settings-export" className={styles.sectionTitle}>
        ESPORTA DATI
      </h2>
      <div className={styles.actions}>
        <Button variant="secondary" icon="download">
          Clienti CSV
        </Button>
        <Button variant="secondary" icon="download">
          Movimenti CSV
        </Button>
      </div>
      <output aria-live="polite" className={styles.status} />
    </section>
  );
}
