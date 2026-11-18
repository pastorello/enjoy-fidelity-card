import type { UsbUidFormat } from '../card-input/normalizeUid';

/** How the USB reader of the cash-desk tablet types a card uid: owned by `card-input`. */
export { USB_UID_FORMATS } from '../card-input/normalizeUid';
export type { UsbUidFormat } from '../card-input/normalizeUid';

/** The bar's configuration (`app.settings`). Amounts are integer cents. */
export type Settings = {
  /** 100 = 1 point every 1,00 € spent. */
  centsPerPoint: number;
  /** A purchase asks for confirmation when its amount is strictly above this. */
  confirmThresholdCents: number;
  usbUidFormat: UsbUidFormat;
  updatedAt: string;
};

export type UpdateSettingsResult =
  | { status: 'ok'; settings: Settings }
  | { status: 'forbidden' | 'invalid' | 'network' | 'unknown' };

export type SettingsLoadErrorKind = 'network' | 'not-found' | 'unknown';

/**
 * Why `SettingsService.load()` failed. 'not-found' means no row is visible (row-level security:
 * the user has no active operator profile), which retrying cannot fix, unlike 'network'.
 */
export class SettingsLoadError extends Error {
  readonly kind: SettingsLoadErrorKind;

  constructor(kind: SettingsLoadErrorKind, message = `Cannot load the settings (${kind})`) {
    super(message);
    this.name = 'SettingsLoadError';
    this.kind = kind;
  }
}

/**
 * Everything the settings feature needs from the backend. The app uses the Supabase
 * implementation; tests pass a fake.
 */
export type SettingsService = {
  /** Reads the configuration row. Rejects with a `SettingsLoadError`. */
  load(): Promise<Settings>;
  /**
   * Saves both values at once (admins only, checked on the server). Never rejects. The USB
   * reader format is never sent from here: the server keeps it unchanged.
   */
  update(input: {
    centsPerPoint: number;
    confirmThresholdCents: number;
  }): Promise<UpdateSettingsResult>;
};
