import { describe, expect, it } from 'vitest';
import { EXPORT_IN_PROGRESS, exportMessage } from './exportMessages';

describe('exportMessage (SPEC-export, point 2)', () => {
  it('announces the file being prepared', () => {
    expect(EXPORT_IN_PROGRESS).toBe('Preparazione del file…');
  });

  it('counts the rows written, always grouped', () => {
    expect(exportMessage('customers', { status: 'ok', count: 312 })).toBe(
      'Clienti esportati: 312.',
    );
    expect(exportMessage('movements', { status: 'ok', count: 4518 })).toBe(
      'Movimenti esportati: 4.518.',
    );
    expect(exportMessage('customers', { status: 'ok', count: 1 })).toBe('Clienti esportati: 1.');
  });

  it('says the file only has the headers when there are no rows', () => {
    expect(exportMessage('customers', { status: 'ok', count: 0 })).toBe(
      'Nessun cliente da esportare: il file contiene solo le intestazioni.',
    );
    expect(exportMessage('movements', { status: 'ok', count: 0 })).toBe(
      'Nessun movimento da esportare: il file contiene solo le intestazioni.',
    );
  });

  it('explains each failure, the same for both files', () => {
    for (const kind of ['customers', 'movements'] as const) {
      expect(exportMessage(kind, { status: 'network' })).toBe(
        'Esportazione non riuscita: controlla la connessione e riprova.',
      );
      expect(exportMessage(kind, { status: 'forbidden' })).toBe(
        'Solo un amministratore può esportare i dati.',
      );
      expect(exportMessage(kind, { status: 'unknown' })).toBe(
        "Esportazione non riuscita. Riprova; se succede ancora, avvisa chi gestisce l'app.",
      );
    }
  });
});
