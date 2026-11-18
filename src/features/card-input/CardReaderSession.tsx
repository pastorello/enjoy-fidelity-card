import { useEffect } from 'react';
import { useSettings } from '../settings/SettingsProvider';
import { useCardReader } from './CardReaderProvider';

/**
 * Turns card reading on while an operator is signed in (SPEC-card-input, point 2): mounted by
 * `RequireAuth` inside `SettingsProvider`, it activates the service on mount and deactivates it on
 * unmount, so nothing is read on /accedi or after "Esci". The USB reader gets the saved format only
 * once the settings are `ready`: while they load, or if loading fails, it stays off (`null`).
 */
export function CardReaderSession() {
  const reader = useCardReader();
  const settings = useSettings();
  const usbFormat = settings.status === 'ready' ? settings.settings.usbUidFormat : null;

  useEffect(() => {
    reader.activate({ usbFormat: null });
    return () => reader.deactivate();
  }, [reader]);

  // Declared after the activation, so on mount it runs after it and passes the format already known.
  useEffect(() => {
    reader.setUsbFormat(usbFormat);
  }, [reader, usbFormat]);

  return null;
}
