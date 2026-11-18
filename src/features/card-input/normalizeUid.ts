/**
 * How a card uid reaches the app: Web NFC always gives 'hex'; the USB reader of the cash-desk tablet
 * types it in the format chosen in the settings. These are exactly the values allowed by
 * `app.settings.usb_uid_format` (checked by usbFormats.test.ts).
 */
export const USB_UID_FORMATS = ['hex', 'hex-reversed', 'dec', 'dec-reversed'] as const;

export type UsbUidFormat = (typeof USB_UID_FORMATS)[number];

const MIN_BYTES = 4;
const MAX_BYTES = 10;
/** ISO 14443 uid lengths, in bytes: a decimal uid is padded to the smallest one that holds it. */
const ISO_LENGTHS = [4, 7, 10] as const;

const HEX_SEPARATED = /^[0-9A-Fa-f]{2}(?:[:\- ][0-9A-Fa-f]{2})*$/;
const HEX_PLAIN = /^(?:[0-9A-Fa-f]{2})+$/;
const DECIMAL = /^[0-9]+$/;

/** Splits the hex digits into bytes, or null if the text is not hex bytes. */
function hexBytes(text: string): string[] | null {
  if (HEX_PLAIN.test(text)) return text.toUpperCase().match(/../g);
  if (HEX_SEPARATED.test(text)) return text.toUpperCase().split(/[:\- ]/);
  return null;
}

/** Converts a decimal uid to bytes padded to 4, 7 or 10 bytes, or null if it needs more. */
function decimalBytes(text: string): string[] | null {
  if (!DECIMAL.test(text)) return null;
  // BigInt: a 7-byte uid can exceed Number.MAX_SAFE_INTEGER.
  const hex = BigInt(text).toString(16).toUpperCase();
  const digits = hex.length + (hex.length % 2);
  const length = ISO_LENGTHS.find((bytes) => bytes * 2 >= digits);
  if (length === undefined) return null;
  return hex.padStart(length * 2, '0').match(/../g);
}

/**
 * Returns the canonical uid (upper-case hex, no separators, 4–10 bytes, as `app.cards.uid`) or null
 * for anything that is not a valid uid in the given format. `format` is a plain string because it
 * comes from the saved settings at run time: an unknown format gives null. Never throws.
 */
export function normalizeUid(raw: string, format: UsbUidFormat | (string & {})): string | null {
  const text = raw.trim();

  let bytes: string[] | null;
  switch (format) {
    case 'hex':
    case 'hex-reversed':
      bytes = hexBytes(text);
      break;
    case 'dec':
    case 'dec-reversed':
      bytes = decimalBytes(text);
      break;
    default:
      return null;
  }

  if (bytes === null || bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) return null;
  if (bytes.every((byte) => byte === '00')) return null;
  if (format === 'hex-reversed' || format === 'dec-reversed') bytes.reverse();
  return bytes.join('');
}
