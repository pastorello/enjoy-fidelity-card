// Minimal Web NFC types (https://w3c.github.io/web-nfc/): they are not in TypeScript's lib.dom.
// Only what card-input uses: scanning, the reading events and writing one URL record
// (SPEC-card-input, points 3 and 9). `makeReadOnly()` is deliberately left out: cards stay writable.

interface NDEFRecord {
  readonly recordType: string;
  readonly mediaType?: string;
  readonly id?: string;
  readonly encoding?: string;
  readonly lang?: string;
  readonly data?: DataView;
}

interface NDEFMessage {
  readonly records: readonly NDEFRecord[];
}

interface NDEFRecordInit {
  recordType: string;
  mediaType?: string;
  id?: string;
  encoding?: string;
  lang?: string;
  data?: string | BufferSource;
}

interface NDEFMessageInit {
  records: NDEFRecordInit[];
}

interface NDEFReadingEvent extends Event {
  readonly serialNumber: string;
  readonly message: NDEFMessage;
}

interface NDEFScanOptions {
  signal?: AbortSignal;
}

interface NDEFWriteOptions {
  overwrite?: boolean;
  signal?: AbortSignal;
}

interface NDEFReader extends EventTarget {
  onreading: ((event: NDEFReadingEvent) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
  scan(options?: NDEFScanOptions): Promise<void>;
  write(message: NDEFMessageInit, options?: NDEFWriteOptions): Promise<void>;
}

interface NDEFReaderConstructor {
  readonly prototype: NDEFReader;
  new (): NDEFReader;
}

interface Window {
  /** Present only in Chrome for Android over HTTPS. */
  readonly NDEFReader?: NDEFReaderConstructor;
}

interface Permissions {
  /** Chrome knows the `nfc` permission; other browsers reject the query (TypeError). */
  query(descriptor: { name: 'nfc' }): Promise<PermissionStatus>;
}
