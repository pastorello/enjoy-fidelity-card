import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { StatusView } from '../../shared/ui/StatusView';
import { useAuth, useCurrentOperator, useDevice } from '../identity/AuthProvider';
import { useSettings } from '../settings/SettingsProvider';
import type { SettingsContextValue } from '../settings/SettingsProvider';
import type { UpdateSettingsResult, UsbUidFormat } from '../settings/types';
import styles from './UsbFormatSection.module.css';

/**
 * "LETTORE CARD" of /impostazioni (SPEC-tablet-kiosk, point 9; Open Questions 14, no wireframe):
 * only on the till tablet with an administrator at the till, between GESTIONE and ESPORTA DATI
 * (docs/specs/cross-review.md §1, item 5). It says how the USB reader types a card uid; the card
 * reader session reads the saved format from the settings, so it applies from the next read.
 * The admin check stays on the server (app.update_settings, `is_admin()` extended to the cashier).
 */
export function UsbFormatSection() {
  const device = useDevice();
  const { role } = useCurrentOperator();
  return device && role === 'admin' ? <AdminUsbFormatSection /> : null;
}

const FORMATS: readonly { value: UsbUidFormat; label: string }[] = [
  { value: 'hex', label: 'Esadecimale' },
  { value: 'hex-reversed', label: 'Esadecimale, byte invertiti' },
  { value: 'dec', label: 'Decimale' },
  { value: 'dec-reversed', label: 'Decimale, byte invertiti' },
];

type SaveFailure = Exclude<UpdateSettingsResult['status'], 'ok'>;

const failureMessages: Record<SaveFailure, string> = {
  network: 'Formato non salvato: controlla la connessione e riprova.',
  forbidden: 'Solo un amministratore può cambiare il formato del lettore.',
  invalid: 'Formato non salvato. Ricarica la pagina e riprova.',
  unknown: 'Formato non salvato. Ricarica la pagina e riprova.',
};

function AdminUsbFormatSection() {
  const settings = useSettings();
  const heading = useRef<HTMLHeadingElement>(null);

  // "Riprova" swaps the error view for the loading one: the focus goes to the heading.
  function retry() {
    if (settings.status !== 'error') return;
    settings.retry();
    heading.current?.focus();
  }

  return (
    <section aria-labelledby="settings-usb-reader" className={styles.section}>
      <h2 ref={heading} id="settings-usb-reader" tabIndex={-1} className={styles.sectionTitle}>
        LETTORE CARD
      </h2>
      {settings.status === 'loading' && <StatusView kind="loading" />}
      {settings.status === 'error' && (
        <StatusView kind="error" title="Impostazioni non caricate" onRetry={retry} />
      )}
      {settings.status === 'ready' && (
        <UsbFormatForm
          format={settings.settings.usbUidFormat}
          saveUsbFormat={settings.saveUsbFormat}
        />
      )}
    </section>
  );
}

function UsbFormatForm({
  format,
  saveUsbFormat,
}: {
  format: UsbUidFormat;
  saveUsbFormat: SettingsContextValue['saveUsbFormat'];
}) {
  const [chosen, setChosen] = useState(format);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<SaveFailure>();
  const { reportNotEnabled } = useAuth();
  // A double tap reaches the handler twice before the busy state renders.
  const saving = useRef(false);

  // A reload (page visible again, another admin saved) moves the choice only if it was not changed.
  const [shown, setShown] = useState(format);
  if (format !== shown) {
    setShown(format);
    if (chosen === shown) setChosen(format);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || failure === 'forbidden') return;
    saving.current = true;
    setBusy(true);
    setSaved(false);
    setFailure(undefined);
    let result: UpdateSettingsResult;
    try {
      result = await saveUsbFormat(chosen);
    } catch {
      result = { status: 'unknown' };
    } finally {
      saving.current = false;
      setBusy(false);
    }

    if (result.status === 'ok') {
      setChosen(result.settings.usbUidFormat);
      setSaved(true);
      return;
    }
    // The choice stays, so Salva can simply be pressed again.
    setFailure(result.status);
    // On the tablet AuthProvider checks the cashier again: an operator now hides this section.
    if (result.status === 'forbidden') void reportNotEnabled();
  }

  return (
    <>
      <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
        <div role="radiogroup" aria-label="Formato del lettore USB" className={styles.options}>
          {FORMATS.map(({ value, label }) => (
            <label key={value} className={styles.option}>
              <input
                type="radio"
                name="usb-uid-format"
                className={styles.radio}
                value={value}
                checked={chosen === value}
                disabled={busy}
                onChange={() => {
                  setChosen(value);
                  setSaved(false);
                }}
              />
              <span className={styles.optionName}>{label}</span>
            </label>
          ))}
        </div>
        <p className={styles.hint}>
          Come il lettore USB scrive il codice della card. Vale dalla lettura successiva.
        </p>
        {failure && (
          <p role="alert" className={styles.failure}>
            <Icon name={failure === 'network' ? 'wifi-off' : 'circle-alert'} size={20} />
            {failureMessages[failure]}
          </p>
        )}
        <Button type="submit" block busy={busy} disabled={failure === 'forbidden'}>
          Salva
        </Button>
      </form>
      {/* Always in the page, so screen readers announce the text when it appears. */}
      <output aria-live="polite" className={styles.saved}>
        {saved && (
          <>
            <Icon name="check" size={20} />
            Formato salvato.
          </>
        )}
      </output>
    </>
  );
}
