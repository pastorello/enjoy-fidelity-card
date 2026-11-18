import { parseCsv } from '../../test/parseCsv';
import { buildMovementsCsv, MOVEMENTS_HEADER } from './buildMovementsCsv';
import { BOM } from './csv';
import type { MovementExportRow } from './types';

const HEADER_LINE =
  'Data e ora;Codice movimento;Codice cliente;Cliente;Tipo;Importo €;Punti;Euro per punto;' +
  'Premio o descrizione;Operatore;Annulla il movimento;Annullato da\r\n';

function movement(overrides: Partial<MovementExportRow> = {}): MovementExportRow {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    createdAt: '2026-07-01T10:05:00.123456+00:00',
    customerId: '00000000-0000-4000-8000-0000000000c1',
    customerName: 'Mario Prova',
    kind: 'purchase',
    amountCents: 1250,
    points: 12,
    centsPerPoint: 100,
    description: null,
    operatorName: 'Anna Banco',
    correctsMovementId: null,
    correctedByMovementId: null,
    ...overrides,
  };
}

function records(csv: string): string[][] {
  expect(csv.startsWith(BOM)).toBe(true);
  return parseCsv(csv.slice(BOM.length));
}

describe('buildMovementsCsv', () => {
  it('starts with the BOM and the exact header of the spec (criterion 3)', () => {
    const csv = buildMovementsCsv([]);
    expect(csv).toBe(BOM + HEADER_LINE);
    expect(MOVEMENTS_HEADER).toHaveLength(12);
  });

  it('writes a purchase of 1250 cents at ratio 100 as 12,50, 12 and 1,00 (criterion 3)', () => {
    const [, row] = records(
      buildMovementsCsv([
        movement({ correctedByMovementId: '00000000-0000-4000-8000-0000000000a9' }),
      ]),
    );
    expect(row).toEqual([
      '01/07/2026 12:05:00',
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000c1',
      'Mario Prova',
      'Spesa',
      '12,50',
      '12',
      '1,00',
      '',
      'Anna Banco',
      '',
      '00000000-0000-4000-8000-0000000000a9',
    ]);
  });

  it('writes a redemption without amount or ratio, with its description', () => {
    const [, row] = records(
      buildMovementsCsv([
        movement({
          kind: 'redemption',
          amountCents: null,
          points: -50,
          centsPerPoint: null,
          description: 'Caffè omaggio',
        }),
      ]),
    );
    expect(row?.slice(4, 9)).toEqual(['Riscatto', '', '-50', '', 'Caffè omaggio']);
  });

  it('writes the corrected movement only on a correction', () => {
    const [, purchase, correction] = records(
      buildMovementsCsv([
        movement({ correctedByMovementId: '00000000-0000-4000-8000-0000000000a2' }),
        movement({
          id: '00000000-0000-4000-8000-0000000000a2',
          kind: 'correction',
          amountCents: null,
          points: -12,
          centsPerPoint: null,
          correctsMovementId: '00000000-0000-4000-8000-0000000000a1',
        }),
      ]),
    );
    expect(purchase?.[10]).toBe('');
    expect(purchase?.[11]).toBe('00000000-0000-4000-8000-0000000000a2');
    expect(correction?.slice(4, 8)).toEqual(['Correzione', '', '-12', '']);
    expect(correction?.[10]).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(correction?.[11]).toBe('');
  });

  it('leaves amount and ratio blank on a non-purchase even if the row carries them', () => {
    const [, row] = records(
      buildMovementsCsv([movement({ kind: 'correction', points: -12, amountCents: 1250 })]),
    );
    expect(row?.[5]).toBe('');
    expect(row?.[7]).toBe('');
  });

  it('writes the movement of an anonymized customer with Cliente blank (criterion 5)', () => {
    const [, row] = records(buildMovementsCsv([movement({ customerName: null })]));
    expect(row?.[3]).toBe('');
    expect(row?.[2]).toBe('00000000-0000-4000-8000-0000000000c1');
    expect(row?.[6]).toBe('12');
  });

  it('guards free text against formulas but leaves numbers alone (criterion 6)', () => {
    const [, row] = records(
      buildMovementsCsv([
        movement({
          customerName: '=1+1',
          kind: 'redemption',
          amountCents: null,
          centsPerPoint: null,
          points: -12,
          description: '@premio',
          operatorName: '+Anna',
        }),
      ]),
    );
    expect(row?.[3]).toBe("'=1+1");
    expect(row?.[8]).toBe("'@premio");
    expect(row?.[9]).toBe("'+Anna");
    expect(row?.[6]).toBe('-12');
  });

  it('keeps the order of the server', () => {
    const rows = records(
      buildMovementsCsv([
        movement({ id: '00000000-0000-4000-8000-0000000000b2', customerName: 'Zeno' }),
        movement({ id: '00000000-0000-4000-8000-0000000000b1', customerName: 'Abele' }),
      ]),
    );
    expect(rows.slice(1).map((r) => r[3])).toEqual(['Zeno', 'Abele']);
  });
});
