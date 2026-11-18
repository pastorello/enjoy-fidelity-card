import { ListRow } from '../../shared/ui/ListRow';
import { useCurrentOperator } from '../identity/AuthProvider';
import styles from './RewardsSettingsSection.module.css';

/**
 * GESTIONE section of /impostazioni (wireframe "Impostazioni", docs/specs/cross-review.md §1):
 * administrators only, after ACCOUNT. The "Operatori" row of the wireframe is deferred
 * (decision 2026-11-17), so the section holds the catalogue row only.
 */
export function RewardsSettingsSection() {
  const operator = useCurrentOperator();
  if (operator.role !== 'admin') return null;
  return (
    <section aria-labelledby="settings-management" className={styles.section}>
      <h2 id="settings-management" className={styles.sectionTitle}>
        GESTIONE
      </h2>
      <ul className={styles.list}>
        <ListRow
          to="/impostazioni/premi"
          title="Catalogo premi"
          subtitle="Premi fissi e punti richiesti"
        />
      </ul>
    </section>
  );
}
