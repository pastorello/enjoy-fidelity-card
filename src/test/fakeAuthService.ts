import { vi } from 'vitest';
import type {
  AuthService,
  Device,
  Operator,
  ResetRequestResult,
  SessionIdentity,
  SignInResult,
  UpdatePasswordResult,
  VerifyRecoveryResult,
} from '../features/identity/types';

export const fakeOperator: Operator = { id: 'op-1', name: 'Giulia Prova', role: 'admin' };
export const fakeDevice: Device = { id: 'dev-1', name: 'Tablet cassa' };

/** A cashier's turn, as `app.unlock_cashier` starts it: 12 hours. */
const TURN_MS = 12 * 60 * 60 * 1000;

/**
 * What a device session holds besides the device: the cashier, the end of the turn and the lock
 * (null or 0: not locked). The shape of `createFakeKioskService().device()`, so a test can pass
 * `() => kiosk.device()` and the two fakes share one cashier, as on the server.
 */
export type FakeDeviceState = {
  cashier: Operator | null;
  turnExpiresAt: Date | null;
  lockSecondsLeft: number | null;
};

type FakeOptions = {
  /** Session already saved on the device. */
  userId?: string | null;
  /** The profile of an operator account; ignored while `device` is set. */
  operator?: Operator | null;
  /**
   * Whether the operator has set a PIN for the till, or a source read on every load (such as
   * `() => kiosk.hasPin(id)`, so a PIN saved through the kiosk fake shows as on the server).
   */
  hasPin?: boolean | (() => boolean);
  /** A device account instead of an operator one, without a cashier unless `cashier` is set. */
  device?: Device;
  /** The device's cashier, with a 12-hour turn starting now. */
  cashier?: Operator;
  signInResult?: SignInResult;
  /** Email of the saved session, returned by `currentEmail()` while signed in. */
  email?: string;
  /** Results returned in order by each call; the last one repeats. Default: always success. */
  resetResults?: ResetRequestResult[];
  verifyResults?: VerifyRecoveryResult[];
  updatePasswordResults?: UpdatePasswordResult[];
  /** The account of the recovery link: a successful `verifyRecovery` switches the session to it. */
  recoveryUser?: { userId: string; operator: Operator | null; email: string };
};

/** Returns the programmed results one per call, repeating the last. */
function sequence<T>(results: readonly T[], fallback: T): () => T {
  let next = 0;
  return () => {
    const result = results[Math.min(next, results.length - 1)] ?? fallback;
    next += 1;
    return result;
  };
}

/**
 * In-memory AuthService for component tests. `loadIdentity()` answers as `app.get_session_identity()`:
 * the operator profile (`setProfile`, `setHasPin`), or a device (`setDevice`) with its cashier
 * (`setCashier`, `expireTurn`, a turn ending at `Date.now()` by fake timers) and lock (`setLock`).
 * `endSession()` simulates an expired session,
 * `switchUser()` another tab or a link saving a different user's session, `removeProfile()`
 * an administrator removing the account while the app is open, `setProfile()` an administrator
 * changing it (such as the role). Every method is a `vi.fn`, so
 * tests count calls (double taps, retries without a second verification) with `toHaveBeenCalledTimes`.
 */
export function createFakeAuthService({
  userId = null,
  operator = fakeOperator,
  hasPin = false,
  device,
  cashier,
  signInResult = 'ok',
  email = 'giulia@example.com',
  resetResults = [],
  verifyResults = [],
  updatePasswordResults = [],
  recoveryUser = { userId: 'user-1', operator, email },
}: FakeOptions = {}) {
  let currentUser = userId;
  let profile = operator;
  let pinSet: boolean | (() => boolean) = hasPin;
  /** The device account, when the session is one; its state is static or read from a source. */
  let deviceAccount: { device: Device; state: FakeDeviceState | (() => FakeDeviceState) } | null =
    device
      ? {
          device,
          state: {
            cashier: cashier ?? null,
            turnExpiresAt: cashier ? new Date(Date.now() + TURN_MS) : null,
            lockSecondsLeft: 0,
          },
        }
      : null;
  let currentAddress = email;
  const nextReset = sequence<ResetRequestResult>(resetResults, 'sent');
  const nextVerify = sequence<VerifyRecoveryResult>(verifyResults, 'ok');
  const nextUpdate = sequence<UpdatePasswordResult>(updatePasswordResults, 'ok');
  const listeners = new Set<(userId: string | null) => void>();
  const notify = (id: string | null) => {
    for (const listener of listeners) listener(id);
  };

  /** Static device state set by the test, or null when the device follows a source. */
  function staticState(): FakeDeviceState {
    if (!deviceAccount) throw new Error('fakeAuthService: not a device session (setDevice first)');
    if (typeof deviceAccount.state === 'function') {
      throw new Error('fakeAuthService: this device follows a source; change it there');
    }
    return deviceAccount.state;
  }

  /** As `app.get_session_identity()`: an ended turn has no cashier and no end. */
  function identity(): SessionIdentity | null {
    if (!deviceAccount) {
      const pin = typeof pinSet === 'function' ? pinSet() : pinSet;
      return profile ? { kind: 'operator', operator: profile, hasPin: pin } : null;
    }
    const { state } = deviceAccount;
    const current = typeof state === 'function' ? state() : state;
    const running =
      current.cashier !== null &&
      current.turnExpiresAt !== null &&
      Date.now() < current.turnExpiresAt.getTime();
    return {
      kind: 'device',
      device: deviceAccount.device,
      cashier: running ? current.cashier : null,
      turnExpiresAt: running ? current.turnExpiresAt : null,
      lockSecondsLeft: Math.max(current.lockSecondsLeft ?? 0, 0),
    };
  }

  const service = {
    currentUserId: vi.fn<AuthService['currentUserId']>(() => Promise.resolve(currentUser)),
    signIn: vi.fn<AuthService['signIn']>(() => {
      if (signInResult === 'ok') {
        currentUser = 'user-1';
        notify(currentUser);
      }
      return Promise.resolve(signInResult);
    }),
    signOut: vi.fn<AuthService['signOut']>(() => {
      currentUser = null;
      return Promise.resolve();
    }),
    loadIdentity: vi.fn<AuthService['loadIdentity']>(() => Promise.resolve(identity())),
    onAuthChange: vi.fn<AuthService['onAuthChange']>((listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    currentEmail: vi.fn<AuthService['currentEmail']>(() =>
      Promise.resolve(currentUser === null ? null : currentAddress),
    ),
    requestPasswordReset: vi.fn<AuthService['requestPasswordReset']>(() =>
      Promise.resolve(nextReset()),
    ),
    verifyRecovery: vi.fn<AuthService['verifyRecovery']>(() => {
      const result = nextVerify();
      if (result === 'ok') {
        // Like verifyOtp: the link session replaces the saved one, without SIGNED_OUT.
        currentUser = recoveryUser.userId;
        profile = recoveryUser.operator;
        deviceAccount = null;
        currentAddress = recoveryUser.email;
        notify(currentUser);
      }
      return Promise.resolve(result);
    }),
    updatePassword: vi.fn<AuthService['updatePassword']>(() => Promise.resolve(nextUpdate())),
    signOutOtherDevices: vi.fn<AuthService['signOutOtherDevices']>(() => Promise.resolve()),
  } satisfies AuthService;

  return {
    service,
    endSession() {
      currentUser = null;
      notify(null);
    },
    /** Another operator account's session (a device session ends). */
    switchUser(nextUserId: string, nextOperator: Operator | null) {
      currentUser = nextUserId;
      profile = nextOperator;
      deviceAccount = null;
      notify(nextUserId);
    },
    /** No profile and no device: the account is not enabled any more. */
    removeProfile() {
      profile = null;
      deviceAccount = null;
    },
    /** An operator account with this profile (a device session ends). */
    setProfile(nextOperator: Operator | null) {
      profile = nextOperator;
      deviceAccount = null;
    },
    setHasPin(next: boolean) {
      pinSet = next;
    },
    /**
     * Makes the session a device account, without a cashier, or following `source` (such as
     * `() => kiosk.device()`) on every read.
     */
    setDevice(nextDevice: Device, source?: () => FakeDeviceState) {
      deviceAccount = {
        device: nextDevice,
        state: source ?? { cashier: null, turnExpiresAt: null, lockSecondsLeft: 0 },
      };
    },
    /** Sets (or clears) the device's cashier; the turn ends in 12 hours unless given. */
    setCashier(next: Operator | null, turnExpiresAt = new Date(Date.now() + TURN_MS)) {
      const state = staticState();
      state.cashier = next;
      state.turnExpiresAt = next ? turnExpiresAt : null;
    },
    /** Ends the turn as the 12 hours would, without moving the clock. */
    expireTurn() {
      const state = staticState();
      if (state.cashier) state.turnExpiresAt = new Date(Date.now());
    },
    /** The PIN lock lasts this many more seconds (0: not locked). */
    setLock(seconds: number) {
      staticState().lockSecondsLeft = seconds;
    },
  };
}
