import { ListRow } from '../../shared/ui/ListRow';
import { useCurrentOperator } from '../identity/AuthProvider';
import { OperatorsSettingsRow } from '../operators/OperatorsSettingsRow';
import styles from './RewardsSettingsSection.module.css';

/**
 * GESTIONE section of /impostazioni (wireframe "Impostazioni", docs/specs/cross-review.md §1):
 * administrators only, after ACCOUNT. As in the wireframe, the "Operatori" row of `operators`
 * (SPEC-operators point 1) comes first, then the catalogue row of `rewards`.
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
        <OperatorsSettingsRow />
        <ListRow
          to="/impostazioni/premi"
          title="Catalogo premi"
          subtitle="Premi fissi e punti richiesti"
        />
      </ul>
    </section>
  );
}
