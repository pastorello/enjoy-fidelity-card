import { parseCsv } from '../../test/parseCsv';
import { BOM, escapeField, excelText, guardFormula, toCsv } from './csv';

describe('escapeField', () => {
  it('leaves a plain field as it is', () => {
    expect(escapeField('Mario Rossi')).toBe('Mario Rossi');
    expect(escapeField('')).toBe('');
    expect(escapeField("D'Amico")).toBe("D'Amico");
  });

  it('quotes a field with a separator, a quote, a CR or a LF and doubles inner quotes', () => {
    expect(escapeField('Rossi; Mario')).toBe('"Rossi; Mario"');
    expect(escapeField('Il "barone"')).toBe('"Il ""barone"""');
    expect(escapeField('riga 1\nriga 2')).toBe('"riga 1\nriga 2"');
    expect(escapeField('riga 1\r\nriga 2')).toBe('"riga 1\r\nriga 2"');
    expect(escapeField('a\rb')).toBe('"a\rb"');
  });
});

describe('guardFormula', () => {
  it.each([
    ['=SOMMA(A1)', "'=SOMMA(A1)"],
    ['+39 333', "'+39 333"],
    ['-Mario', "'-Mario"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
    ['\rcmd', "'\rcmd"],
  ])('puts an apostrophe before %j', (value, expected) => {
    expect(guardFormula(value)).toBe(expected);
  });

  it('leaves text that does not start with a trigger alone', () => {
    expect(guardFormula('Mario = Rossi')).toBe('Mario = Rossi');
    expect(guardFormula(' =1+1')).toBe(' =1+1');
    expect(guardFormula('')).toBe('');
  });
});

describe('excelText', () => {
  it('writes a phone number or a card uid as an Excel text formula', () => {
    expect(excelText('+393331234567')).toBe('="+393331234567"');
    expect(excelText('04A1B2C3D4E5F6')).toBe('="04A1B2C3D4E5F6"');
  });

  it('doubles the quotes of the formula once the field is escaped', () => {
    expect(escapeField(excelText('+393331234567'))).toBe('"=""+393331234567"""');
  });

  it('falls back to guarded free text when the value is not a plain number or hex uid', () => {
    expect(excelText('+39"),HYPERLINK("x')).toBe('\'+39"),HYPERLINK("x');
    expect(excelText('+39ABCXYZ')).toBe("'+39ABCXYZ");
    expect(excelText('04a1b2c3')).toBe('04a1b2c3');
    expect(excelText('=1+1')).toBe("'=1+1");
    expect(excelText('+' + '1'.repeat(21))).toBe("'+" + '1'.repeat(21));
  });

  it('leaves an empty value empty', () => {
    expect(excelText('')).toBe('');
  });
});

describe('toCsv', () => {
  it('starts with the BOM and ends every record, the last too, with CRLF', () => {
    const text = toCsv(['Nome', 'Saldo punti'], [['Mario', '12']]);
    expect(BOM).toBe('﻿');
    expect(text).toBe('﻿Nome;Saldo punti\r\nMario;12\r\n');
  });

  it('writes only the header when there are no rows', () => {
    expect(toCsv(['Nome', 'Note'], [])).toBe('﻿Nome;Note\r\n');
  });

  it('leaves numeric cells intact: no guard on amounts or points', () => {
    const text = toCsv(['Importo €', 'Punti'], [['-12,50', '-12']]);
    expect(text).toBe('﻿Importo €;Punti\r\n-12,50;-12\r\n');
  });

  it('round-trips names with separators, quotes and line breaks through an RFC 4180 reader', () => {
    const header = ['Codice cliente', 'Nome', 'Note', 'Telefono'];
    const rows = [
      [
        'c1',
        guardFormula('Rossi; Mario "il barone"'),
        guardFormula('riga 1\r\nriga 2'),
        excelText('+393331234567'),
      ],
      ['c2', guardFormula('=SOMMA(A1)'), guardFormula('nota; con "virgolette"\n'), excelText('')],
      ['c3', guardFormula('-Bianchi;"x"'), guardFormula('\rinizio'), excelText('+39"x')],
    ];
    const text = toCsv(header, rows);
    expect(text.startsWith(BOM)).toBe(true);

    const parsed = parseCsv(text.slice(BOM.length));
    expect(parsed).toEqual([header, ...rows]);
    expect(parsed[1]?.[1]).toBe('Rossi; Mario "il barone"');
    expect(parsed[2]?.[1]).toBe("'=SOMMA(A1)");
    expect(parsed[1]?.[3]).toBe('="+393331234567"');
  });

  it('quotes a guarded name only when it holds a separator, a quote or a line break', () => {
    expect(toCsv(['Nome'], [[guardFormula('=1+1')]])).toBe("﻿Nome\r\n'=1+1\r\n");
    expect(toCsv(['Nome'], [[guardFormula('=1;2')]])).toBe('﻿Nome\r\n"\'=1;2"\r\n');
  });
});
