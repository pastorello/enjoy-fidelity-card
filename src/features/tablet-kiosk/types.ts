import type { Operator, Role } from '../identity/types';

// Types of the cash-desk tablet (SPEC-tablet-kiosk, "Code Style"). Every check (PIN, lock, turn,
// role) happens on the server: these types only carry its answers. A PIN goes to the server and
// nowhere else: no type here keeps it.

/** Someone who can be chosen at the till (`app.list_cashiers`): a linked operator. */
export type Cashier = {
  id: string;
  name: string;
  role: Role;
  /** False until the person sets a PIN from their own phone: shown disabled at the till. */
  hasPin: boolean;
};

/** What `app.unlock_cashier` answered. The seconds of a lock are the server's, never the tablet's. */
export type UnlockResult =
  | { status: 'ok'; cashier: Operator; turnExpiresAt: Date }
  | { status: 'wrong-pin'; attemptsLeft: number }
  | { status: 'locked'; lockSecondsLeft: number }
  | { status: 'no-pin' }
  | { status: 'network' };

/** What setting one's own PIN ended with; any other failure rejects. */
export type SetPinResult = { status: 'ok' } | { status: 'network' };

/**
 * Why a kiosk request failed outside the results above: 'forbidden' (42501 from the app: not a device,
 * or not an operator account), 'invalid' (22023: a PIN that is not 4 digits, a bug in the client),
 * 'network' (no answer), 'unknown' (anything else, a malformed answer included). A server fault
 * rejects with `ServerFaultError` instead.
 */
export type KioskErrorKind = 'forbidden' | 'invalid' | 'network' | 'unknown';

/** Rejected by the kiosk service. Its message names the kind only, never a PIN or a name. */
export class KioskError extends Error {
  readonly kind: KioskErrorKind;

  constructor(kind: KioskErrorKind) {
    super(`Kiosk request failed (${kind})`);
    this.name = 'KioskError';
    this.kind = kind;
  }
}

/**
 * Everything the tablet-kiosk feature needs from the backend. The app uses the Supabase
 * implementation; tests pass a fake.
 */
export type KioskService = {
  /** The operators that can be chosen at the till (device accounts only). Rejects on failure. */
  listCashiers(): Promise<Cashier[]>;
  /**
   * Checks the PIN on the server and, when right, makes that person the device's cashier.
   * No answer resolves with `network`; a refusal or a malformed answer rejects.
   */
  unlock(operatorId: string, pin: string): Promise<UnlockResult>;
  /** Ends the cashier's turn on this device (idempotent). Rejects on failure. */
  endTurn(): Promise<void>;
  /**
   * Sets the caller's own 4-digit PIN (operator accounts only) and closes their open turns on every
   * tablet. No answer resolves with `network`; a refusal rejects.
   */
  setMyPin(pin: string): Promise<SetPinResult>;
};
