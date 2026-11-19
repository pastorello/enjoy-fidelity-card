import { useDevice } from '../identity/AuthProvider';

/**
 * Whether cards come from the USB reader only (SPEC-tablet-kiosk, point 8): true in a device
 * session, the till tablet, which has no NFC. Chosen from the session, not from the layout: the
 * tablet in portrait or in a narrow window gets the single-column screens with the same reader.
 */
export function useUsbCardInput(): boolean {
  return useDevice() !== null;
}
