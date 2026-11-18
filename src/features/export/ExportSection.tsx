import { useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useAuth, useCurrentOperator } from '../identity/AuthProvider';
import styles from './ExportSection.module.css';
import { EXPORT_IN_PROGRESS, exportMessage } from './exportMessages';
import type { ExportKind } from './types';
import { useExport } from './useExport';

/**
 * ESPORTA DATI section of /impostazioni (wireframe "Impostazioni", SPEC-export point 1): the last
 * section, administrators only. Hiding it is a convenience: the export functions refuse operators on
 * the server. The live region below the buttons announces the export states (point 2).
 */
export function ExportSection() {
  const operator = useCurrentOperator();
  if (operator.role !== 'admin') return null;
  return <AdminExportSection />;
}

function AdminExportSection() {
  const { reportNotEnabled } = useAuth();
  const customers = useExport('customers');
  const movements = useExport('movements');
  // One region for both buttons: it says what happened last, whichever file it was.
  const [message, setMessage] = useState('');
  // The files being exported, set synchronously: a double tap reaches here twice before `busy`
  // renders, and must neither announce twice nor report a refusal twice (the hook already starts one
  // export only).
  const running = useRef(new Set<ExportKind>());

  async function start(kind: ExportKind, exporter: ReturnType<typeof useExport>) {
    if (running.current.has(kind)) return;
    running.current.add(kind);
    setMessage(EXPORT_IN_PROGRESS);
    const result = await exporter.run();
    running.current.delete(kind);
    setMessage(exportMessage(kind, result));
    // The role may have changed or the profile gone: AuthProvider checks again and either hides this
    // section (operator) or goes back to /accedi.
    if (result.status === 'forbidden') void reportNotEnabled();
  }

  return (
    <section aria-labelledby="settings-export" className={styles.section}>
      <h2 id="settings-export" className={styles.sectionTitle}>
        ESPORTA DATI
      </h2>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          icon="download"
          busy={customers.busy}
          onClick={() => void start('customers', customers)}
        >
          Clienti CSV
        </Button>
        <Button
          variant="secondary"
          icon="download"
          busy={movements.busy}
          onClick={() => void start('movements', movements)}
        >
          Movimenti CSV
        </Button>
      </div>
      <output aria-live="polite" className={styles.status}>
        {message}
      </output>
    </section>
  );
}
