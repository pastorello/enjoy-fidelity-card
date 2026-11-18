// The texts of the ESPORTA DATI live region (SPEC-export, point 2). They name the kind of file and the
// row count only, never a row.

import { formatInteger } from '../../shared/format';
import type { ExportKind, ExportResult } from './types';

/** Announced as soon as a button is tapped. */
export const EXPORT_IN_PROGRESS = 'Preparazione del file…';

const done: Record<ExportKind, { label: string; none: string }> = {
  customers: { label: 'Clienti esportati', none: 'Nessun cliente da esportare' },
  movements: { label: 'Movimenti esportati', none: 'Nessun movimento da esportare' },
};

const failed: Record<Exclude<ExportResult['status'], 'ok'>, string> = {
  network: 'Esportazione non riuscita: controlla la connessione e riprova.',
  forbidden: 'Solo un amministratore può esportare i dati.',
  unknown: "Esportazione non riuscita. Riprova; se succede ancora, avvisa chi gestisce l'app.",
};

/** What the region says when an export of `kind` ends with `result`. */
export function exportMessage(kind: ExportKind, result: ExportResult): string {
  if (result.status !== 'ok') return failed[result.status];
  return result.count === 0
    ? `${done[kind].none}: il file contiene solo le intestazioni.`
    : `${done[kind].label}: ${formatInteger(result.count)}.`;
}
