/**
 * A short vibration where the device has one (SPEC-ledger, point 3: `navigator.vibrate?.(200)` on
 * "Spesa registrata"). The browser APIs of the card stay in card-input (scripts/
 * cardInputBoundary.test.ts), so other modules vibrate through here. Absent on iPhone and on
 * desktop; a refusal of the browser is ignored.
 */
export function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Nothing to do: the vibration is only a confirmation for the hand holding the phone.
  }
}
