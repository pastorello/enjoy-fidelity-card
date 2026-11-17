import { formatCents } from '../../shared/format';
import { StatusView } from '../../shared/ui/StatusView';
import { useCurrentOperator } from '../identity/AuthProvider';
import { useSettings } from './SettingsProvider';
import styles from './PointsSettingsSection.module.css';

/**
 * Section 2 of /impostazioni (docs/specs/cross-review.md §1). Operators see "PUNTI", the ratio
 * read-only (wireframe "Impostazioni operatore"); the administrator view "PUNTI E CONTROLLI" is
 * not built yet, so administrators see nothing here for now.
 */
export function PointsSettingsSection() {
  const operator = useCurrentOperator();
  if (operator.role !== 'operator') return null;
  return <OperatorPointsSection />;
}

function OperatorPointsSection() {
  const settings = useSettings();

  return (
    <section aria-labelledby="settings-points" className={styles.section}>
      <h2 id="settings-points" className={styles.sectionTitle}>
        PUNTI
      </h2>
      {settings.status === 'loading' && <StatusView kind="loading" />}
      {settings.status === 'error' && (
        <StatusView kind="error" title="Impostazioni non caricate" onRetry={settings.retry} />
      )}
      {settings.status === 'ready' && (
        <>
          <p className={styles.ratio}>
            1 punto ogni {formatCents(settings.settings.centsPerPoint)} di spesa
          </p>
          <p className={styles.hint}>Il rapporto lo decide un amministratore.</p>
        </>
      )}
    </section>
  );
}

/** Last element of /impostazioni, for operators only (cross-review.md §1, item 7). */
export function OperatorFinalNote() {
  const operator = useCurrentOperator();
  if (operator.role !== 'operator') return null;
  return (
    <p className={styles.note}>
      Operatori, premi, esportazioni e annullamenti dei movimenti li gestiscono gli amministratori.
    </p>
  );
}
