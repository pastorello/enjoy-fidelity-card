// Test helper for the CSV export: reads back what csv.ts writes.

/**
 * A strict RFC 4180 reader with ';' as separator, kept apart from csv.ts so the tests do not trust it to
 * read back its own output: quoted fields may hold ';', CR, LF and doubled quotes; every record ends
 * with CRLF. It throws on anything malformed (a stray quote, a missing terminator).
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let i = 0;
  let atFieldStart = true;
  while (i < text.length) {
    const ch = text[i];
    if (atFieldStart && ch === '"') {
      i += 1;
      for (;;) {
        if (i >= text.length) throw new Error('unterminated quoted field');
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        field += text[i];
        i += 1;
      }
      atFieldStart = false;
      const next = text[i];
      if (next !== ';' && next !== '\r') throw new Error(`unexpected ${String(next)} after quote`);
      continue;
    }
    if (ch === ';') {
      record.push(field);
      field = '';
      atFieldStart = true;
      i += 1;
    } else if (ch === '\r') {
      if (text[i + 1] !== '\n') throw new Error('CR without LF');
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      atFieldStart = true;
      i += 2;
    } else if (ch === '"' || ch === '\n') {
      throw new Error(`bare ${JSON.stringify(ch)} in unquoted field`);
    } else {
      field += ch;
      atFieldStart = false;
      i += 1;
    }
  }
  if (!atFieldStart || field !== '' || record.length > 0)
    throw new Error('last record without CRLF');
  return records;
}
