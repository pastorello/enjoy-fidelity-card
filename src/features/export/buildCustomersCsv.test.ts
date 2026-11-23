import { parseCsv } from '../../test/parseCsv';
import { buildCustomersCsv, CUSTOMERS_HEADER } from './buildCustomersCsv';
import { BOM } from './csv';
import type { CustomerExportRow } from './types';

const HEADER_LINE =
  'Codice cliente;Nome;Email;Card attiva;Saldo punti;Consenso privacy;Note;Creato il;' +
  'Creato da;Anonimizzato il\r\n';

let nextId = 0;

function customer(overrides: Partial<CustomerExportRow> = {}): CustomerExportRow {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    name: 'Mario Prova',
    email: 'mario.prova@example.com',
    activeCardUid: '04A1B2C3D4E5F6',
    balancePoints: 42,
    privacyConsentAt: '2026-01-15T10:05:00+00:00',
    notes: null,
    createdAt: '2026-01-15T10:05:00+00:00',
    createdByName: 'Anna Banco',
    anonymizedAt: null,
    ...overrides,
  };
}

function records(csv: string): string[][] {
  expect(csv.startsWith(BOM)).toBe(true);
  return parseCsv(csv.slice(BOM.length));
}

describe('buildCustomersCsv', () => {
  it('writes only the header when there are no rows (criterion 6)', () => {
    expect(buildCustomersCsv([])).toBe(BOM + HEADER_LINE);
    expect(CUSTOMERS_HEADER).toHaveLength(10);
  });

  it('writes the columns in the order of the spec, the email after the name and the uid as Excel text', () => {
    const row = customer({
      id: '00000000-0000-4000-8000-0000000000c1',
      notes: 'Preferisce il decaffeinato',
      privacyConsentAt: '2026-07-01T10:05:00+00:00',
    });
    const [, record] = records(buildCustomersCsv([row]));
    expect(record).toEqual([
      '00000000-0000-4000-8000-0000000000c1',
      'Mario Prova',
      'mario.prova@example.com',
      '="04A1B2C3D4E5F6"',
      '42',
      '01/07/2026 12:05:00',
      'Preferisce il decaffeinato',
      '15/01/2026 11:05:00',
      'Anna Banco',
      '',
    ]);
  });

  it('leaves email and card blank when missing and writes a negative balance as a number', () => {
    const [, record] = records(
      buildCustomersCsv([customer({ email: null, activeCardUid: null, balancePoints: -3 })]),
    );
    expect(record?.slice(2, 5)).toEqual(['', '', '-3']);
  });

  it('blanks the personal fields of an anonymized customer even if the row has them (criterion 5)', () => {
    const [, record] = records(
      buildCustomersCsv([
        customer({
          name: 'Nome Residuo',
          email: 'residuo@example.com',
          activeCardUid: '04FFFFFFFFFFFF',
          notes: 'Nota residua',
          balancePoints: 17,
          anonymizedAt: '2026-11-17T09:00:00+00:00',
        }),
      ]),
    );
    expect(record?.[1]).toBe('');
    expect(record?.[2]).toBe('');
    expect(record?.[3]).toBe('');
    expect(record?.[6]).toBe('');
    expect(record?.[4]).toBe('17');
    expect(record?.[9]).toBe('17/11/2026 10:00:00');
  });

  it('guards a name, a note and an operator name against formulas (criterion 6)', () => {
    const [, record] = records(
      buildCustomersCsv([customer({ name: '=1+1', notes: '-nota', createdByName: '@Anna' })]),
    );
    expect(record?.[1]).toBe("'=1+1");
    expect(record?.[6]).toBe("'-nota");
    expect(record?.[8]).toBe("'@Anna");
  });

  it('guards an email whose local part starts a formula (criterion 4)', () => {
    const emails = ['=cmd@example.com', '+somma@example.com', '-meno@example.com'];
    const cells = emails.map((email) => records(buildCustomersCsv([customer({ email })]))[1]?.[2]);
    expect(cells).toEqual(["'=cmd@example.com", "'+somma@example.com", "'-meno@example.com"]);
  });

  it('reads back a name with ";" and quotes as one identical field (criterion 6)', () => {
    const name = 'Rossi; detto "il Biondo"';
    const csv = buildCustomersCsv([customer({ name })]);
    expect(csv).toContain('"Rossi; detto ""il Biondo"""');
    expect(records(csv)[1]?.[1]).toBe(name);
  });

  it('sorts by name in Italian, accents and case aside, anonymized last by creation (criterion 6)', () => {
    const rows = [
      customer({ name: 'Fabio' }),
      customer({
        name: null,
        anonymizedAt: '2026-11-01T00:00:00Z',
        createdAt: '2026-03-01T00:00:00Z',
        balancePoints: 2,
      }),
      customer({ name: 'Èlia' }),
      customer({
        name: null,
        anonymizedAt: '2026-11-02T00:00:00Z',
        createdAt: '2026-02-01T00:00:00Z',
        balancePoints: 1,
      }),
      customer({ name: 'Elia' }),
      customer({ name: 'andrea' }),
    ];
    const sorted = records(buildCustomersCsv(rows))
      .slice(1)
      .map((r) => r[1] || `anonimo ${String(r[4])}`);
    expect(sorted).toEqual(['andrea', 'Elia', 'Èlia', 'Fabio', 'anonimo 1', 'anonimo 2']);
  });

  it('does not reorder the rows it was given', () => {
    const rows = [customer({ name: 'Zeno' }), customer({ name: 'Abele' })];
    buildCustomersCsv(rows);
    expect(rows.map((r) => r.name)).toEqual(['Zeno', 'Abele']);
  });
});
