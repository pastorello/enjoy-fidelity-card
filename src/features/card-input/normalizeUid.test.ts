import { describe, expect, it } from 'vitest';
import { normalizeUid, USB_UID_FORMATS } from './normalizeUid';
import type { UsbUidFormat } from './normalizeUid';

// Invented uids only (SPEC-card-input, "Boundaries"): never the code of a real card.
const UID = '04A1B2C3D4E5F6';

describe('normalizeUid: acceptance criterion 1', () => {
  it.each<[string, UsbUidFormat]>([
    ['04:a1:b2:c3:d4:e5:f6', 'hex'],
    ['1303689068602870', 'dec'],
    ['69495546249912580', 'dec-reversed'],
    ['F6E5D4C3B2A104', 'hex-reversed'],
  ])('%s (%s) → 04A1B2C3D4E5F6', (raw, format) => {
    expect(normalizeUid(raw, format)).toBe(UID);
  });
});

describe("normalizeUid: 'hex'", () => {
  it.each([
    ['04:a1:b2:c3:d4:e5:f6'],
    ['04:A1:B2:C3:D4:E5:F6'],
    ['04-a1-b2-c3-d4-e5-f6'],
    ['04 a1 b2 c3 d4 e5 f6'],
    ['04a1b2c3d4e5f6'],
    ['04A1B2C3D4E5F6'],
    ['  04:a1:b2:c3:d4:e5:f6  '],
    ['\t04A1B2C3D4E5F6\n'],
  ])('%j → 04A1B2C3D4E5F6', (raw) => {
    expect(normalizeUid(raw, 'hex')).toBe(UID);
  });

  it('accepts 4, 7 and 10 bytes', () => {
    expect(normalizeUid('de:ad:be:ef', 'hex')).toBe('DEADBEEF');
    expect(normalizeUid('04a1b2c3d4e5f6', 'hex')).toBe(UID);
    expect(normalizeUid('0102030405060708090a', 'hex')).toBe('0102030405060708090A');
  });

  it('accepts lengths between 4 and 10 bytes (the canonical form is any even 8–20 digits)', () => {
    expect(normalizeUid('0102030405', 'hex')).toBe('0102030405');
  });

  it('keeps leading zero bytes', () => {
    expect(normalizeUid('00:00:00:01', 'hex')).toBe('00000001');
  });
});

describe("normalizeUid: 'hex-reversed'", () => {
  it('reverses the byte order after reading like hex', () => {
    expect(normalizeUid('F6E5D4C3B2A104', 'hex-reversed')).toBe(UID);
    expect(normalizeUid('f6:e5:d4:c3:b2:a1:04', 'hex-reversed')).toBe(UID);
    expect(normalizeUid('f6-e5-d4-c3-b2-a1-04', 'hex-reversed')).toBe(UID);
    expect(normalizeUid('EF BE AD DE', 'hex-reversed')).toBe('DEADBEEF');
  });
});

describe("normalizeUid: 'dec'", () => {
  it('converts a 7-byte uid exactly, also above Number.MAX_SAFE_INTEGER', () => {
    expect(normalizeUid('1303689068602870', 'dec')).toBe(UID);
    // 0xFFEEDDCCBBAA99 = 72038755451251353 does not fit a double: Number() would round it.
    expect(72038755451251353n > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(normalizeUid('72038755451251353', 'dec')).toBe('FFEEDDCCBBAA99');
  });

  it('keeps leading zeros and pads to 4 bytes', () => {
    expect(normalizeUid('0012345678', 'dec')).toBe('00BC614E');
    expect(normalizeUid('1', 'dec')).toBe('00000001');
  });

  it('pads to the smallest ISO 14443 length: 4, 7 or 10 bytes', () => {
    // 0xFFFFFFFF still fits 4 bytes.
    expect(normalizeUid('4294967295', 'dec')).toBe('FFFFFFFF');
    // 0x0100000000 needs 5 bytes → padded to 7.
    expect(normalizeUid('4294967296', 'dec')).toBe('00000100000000');
    // 0xFFFFFFFFFFFFFF still fits 7 bytes.
    expect(normalizeUid('72057594037927935', 'dec')).toBe('FFFFFFFFFFFFFF');
    // 2^56 needs 8 bytes → padded to 10.
    expect(normalizeUid('72057594037927936', 'dec')).toBe('00000100000000000000');
    // The largest 10-byte value.
    expect(normalizeUid('1208925819614629174706175', 'dec')).toBe('FFFFFFFFFFFFFFFFFFFF');
  });

  it('trims outer spaces', () => {
    expect(normalizeUid(' 1303689068602870\n', 'dec')).toBe(UID);
  });
});

describe("normalizeUid: 'dec-reversed'", () => {
  it('reverses the bytes after padding', () => {
    expect(normalizeUid('69495546249912580', 'dec-reversed')).toBe(UID);
    // 1 → 00000001 → reversed 01000000.
    expect(normalizeUid('1', 'dec-reversed')).toBe('01000000');
    // 0xBC614E → 00BC614E → reversed 4E61BC00.
    expect(normalizeUid('12345678', 'dec-reversed')).toBe('4E61BC00');
  });
});

describe('normalizeUid: invalid input → null', () => {
  it.each<[string, UsbUidFormat]>([
    ['', 'hex'],
    ['', 'dec'],
    ['   ', 'hex'],
    [' \t\n', 'dec'],
    ['04:a1:b', 'hex'],
    ['4:a1:b2:c3', 'hex'],
    ['04:a1:b2:c3d4', 'hex'],
    ['04::a1:b2:c3', 'hex'],
    [':04:a1:b2:c3', 'hex'],
    ['04:a1:b2:c3:', 'hex'],
    ['0g', 'hex'],
    ['04a1b2c3d4e5fg', 'hex'],
    ['04a1b2c3d4e5f', 'hex'],
    ['04a1b2c3d', 'hex-reversed'],
    ['04a1b2', 'hex'],
    ['04:a1:b2', 'hex'],
    ['0102030405060708090a0b', 'hex'],
    ['01:02:03:04:05:06:07:08:09:0a:0b', 'hex-reversed'],
    ['00000000', 'hex'],
    ['00:00:00:00:00:00:00', 'hex-reversed'],
    ['0', 'dec'],
    ['0000000000', 'dec'],
    ['0', 'dec-reversed'],
    ['-1303689068602870', 'dec'],
    ['+1303689068602870', 'dec'],
    ['1303689068602870.0', 'dec'],
    ['1303.689068602870', 'dec-reversed'],
    ['1e9', 'dec'],
    ['0x04A1B2C3', 'dec'],
    ['04A1B2C3', 'dec'],
    ['1303 689068602870', 'dec'],
    // 2^80 needs 11 bytes.
    ['1208925819614629174706176', 'dec'],
    ['1208925819614629174706176', 'dec-reversed'],
    ['99999999999999999999999999999999999999', 'dec'],
  ])('%j (%s)', (raw, format) => {
    expect(normalizeUid(raw, format)).toBeNull();
  });

  it('rejects an unknown format', () => {
    expect(normalizeUid('04A1B2C3D4E5F6', 'hexadecimal')).toBeNull();
    expect(normalizeUid('04A1B2C3D4E5F6', 'HEX')).toBeNull();
    expect(normalizeUid('04A1B2C3D4E5F6', '')).toBeNull();
  });
});

describe('normalizeUid: output shape', () => {
  it('always returns the canonical form of app.cards.uid or null', () => {
    const inputs = ['04:a1:b2:c3', '1', '4294967296', '72057594037927936', 'deadbeef', 'x'];
    const outputs = USB_UID_FORMATS.flatMap((format) =>
      inputs.map((raw) => normalizeUid(raw, format)),
    );
    const uids = outputs.filter((uid): uid is string => uid !== null);
    expect(uids.length).toBeGreaterThan(0);
    for (const uid of uids) expect(uid).toMatch(/^(?:[0-9A-F]{2}){4,10}$/);
  });
});
