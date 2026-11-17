import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { formatCents } from '../../shared/format';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { StatusView } from '../../shared/ui/StatusView';
import { TextField } from '../../shared/ui/TextField';
import { useAuth, useCurrentOperator } from '../identity/AuthProvider';
import {
  CENTS_PER_POINT_LIMIT,
  CONFIRM_THRESHOLD_LIMIT,
  centsToEuroInput,
  parseEuroInput,
} from './parseEuroInput';
import { useSettings, type SettingsContextValue } from './SettingsProvider';
import type { Settings, UpdateSettingsResult } from './types';
import styles from './PointsSettingsSection.module.css';

/**
 * Section 2 of /impostazioni (docs/specs/cross-review.md §1). Administrators edit the ratio and
 * the confirmation threshold in "PUNTI E CONTROLLI" (wireframe "Impostazioni"); operators see
 * "PUNTI", the ratio read-only (wireframe "Impostazioni operatore").
 */
export function PointsSettingsSection() {
  const operator = useCurrentOperator();
  return operator.role === 'admin' ? <AdminPointsSection /> : <OperatorPointsSection />;
}

function AdminPointsSection() {
  const settings = useSettings();
  const { heading, retry } = useRetryKeepingFocus(settings);

  return (
    <section aria-labelledby="settings-points" className={styles.section}>
      <h2 ref={heading} id="settings-points" tabIndex={-1} className={styles.sectionTitle}>
        PUNTI E CONTROLLI
      </h2>
      {settings.status === 'loading' && <StatusView kind="loading" />}
      {settings.status === 'error' && (
        <StatusView kind="error" title="Impostazioni non caricate" onRetry={retry} />
      )}
      {settings.status === 'ready' && (
        <PointsAndControlsForm settings={settings.settings} save={settings.save} />
      )}
    </section>
  );
}

/**
 * "Riprova" swaps the error view, button included, for the loading one: without this the focus
 * would fall back to <body>. It moves to the section heading, which stays mounted while the
 * section loads, fails again or shows its content.
 */
function useRetryKeepingFocus(settings: SettingsContextValue) {
  const heading = useRef<HTMLHeadingElement>(null);
  const retry = () => {
    if (settings.status !== 'error') return;
    settings.retry();
    heading.current?.focus();
  };
  return { heading, retry };
}

type Field = 'ratio' | 'threshold';
type FieldErrors = { [field in Field]?: string | undefined };
type SaveFailure = Exclude<UpdateSettingsResult['status'], 'ok'>;

const failureMessages: Record<SaveFailure, string> = {
  network: 'Impostazioni non salvate: controlla la connessione e riprova.',
  forbidden: 'Solo un amministratore può cambiare queste impostazioni.',
  invalid: 'Impostazioni non salvate. Ricarica la pagina e riprova.',
  unknown: 'Impostazioni non salvate. Ricarica la pagina e riprova.',
};

function PointsAndControlsForm({
  settings,
  save,
}: {
  settings: Settings;
  save: SettingsContextValue['save'];
}) {
  const [ratio, setRatio] = useState(() => centsToEuroInput(settings.centsPerPoint));
  const [threshold, setThreshold] = useState(() =>
    centsToEuroInput(settings.confirmThresholdCents),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<SaveFailure>();
  const { reportNotEnabled } = useAuth();

  // A reload (page visible again, another admin saved) refreshes the fields still showing the
  // last values received, and never overwrites one edited and not saved (SPEC-settings, point 7).
  const [shown, setShown] = useState(settings);
  if (settings !== shown) {
    setShown(settings);
    if (ratio === centsToEuroInput(shown.centsPerPoint)) {
      setRatio(centsToEuroInput(settings.centsPerPoint));
    }
    if (threshold === centsToEuroInput(shown.confirmThresholdCents)) {
      setThreshold(centsToEuroInput(settings.confirmThresholdCents));
    }
  }
  // A double tap reaches the handler twice before the busy state renders.
  const saving = useRef(false);

  const ratioInput = useRef<HTMLInputElement>(null);
  const thresholdInput = useRef<HTMLInputElement>(null);
  // Focus moves after the render that shows the error, so the field is announced with it.
  // Each failed Salva makes a new request object, so the effect runs again.
  const [focusRequest, setFocusRequest] = useState<{ field: Field }>();
  useEffect(() => {
    if (!focusRequest) return;
    (focusRequest.field === 'ratio' ? ratioInput : thresholdInput).current?.focus();
  }, [focusRequest]);

  function edit(setValue: (value: string) => void) {
    return (value: string) => {
      setValue(value);
      setSaved(false);
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // After a refusal Salva stays disabled; Invio in a field must not send either.
    if (saving.current || failure === 'forbidden') return;
    const parsedRatio = parseEuroInput(ratio, CENTS_PER_POINT_LIMIT);
    const parsedThreshold = parseEuroInput(threshold, CONFIRM_THRESHOLD_LIMIT);
    setErrors({
      ratio: parsedRatio.ok ? undefined : parsedRatio.error,
      threshold: parsedThreshold.ok ? undefined : parsedThreshold.error,
    });
    setSaved(false);
    setFailure(undefined);
    if (!parsedRatio.ok || !parsedThreshold.ok) {
      setFocusRequest({ field: parsedRatio.ok ? 'threshold' : 'ratio' });
      return;
    }

    saving.current = true;
    setBusy(true);
    let result: UpdateSettingsResult;
    try {
      result = await save({
        centsPerPoint: parsedRatio.cents,
        confirmThresholdCents: parsedThreshold.cents,
      });
    } catch {
      result = { status: 'unknown' };
    } finally {
      saving.current = false;
      setBusy(false);
    }

    if (result.status === 'ok') {
      setRatio(centsToEuroInput(result.settings.centsPerPoint));
      setThreshold(centsToEuroInput(result.settings.confirmThresholdCents));
      setSaved(true);
      return;
    }
    // The typed values stay in the fields, so Salva can simply be pressed again.
    setFailure(result.status);
    // The role may have changed or the profile gone: AuthProvider checks again and either
    // switches this section to the operator view or goes back to /accedi.
    if (result.status === 'forbidden') void reportNotEnabled();
  }

  return (
    <>
      <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
        <TextField
          ref={ratioInput}
          label="1 punto ogni"
          layout="inline"
          suffix="€"
          inputMode="decimal"
          autoComplete="off"
          value={ratio}
          onChange={edit(setRatio)}
          error={errors.ratio}
          readOnly={busy}
        />
        <TextField
          ref={thresholdInput}
          label="Chiedi conferma sopra"
          layout="inline"
          suffix="€"
          inputMode="decimal"
          autoComplete="off"
          value={threshold}
          onChange={edit(setThreshold)}
          error={errors.threshold}
          readOnly={busy}
        />
        <p className={styles.hint}>
          Il rapporto vale per le spese registrate da ora in poi. La conferma evita errori di
          battitura, come 1250 al posto di 12,50.
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
            Impostazioni salvate.
          </>
        )}
      </output>
    </>
  );
}

function OperatorPointsSection() {
  const settings = useSettings();
  const { heading, retry } = useRetryKeepingFocus(settings);

  return (
    <section aria-labelledby="settings-points" className={styles.section}>
      <h2 ref={heading} id="settings-points" tabIndex={-1} className={styles.sectionTitle}>
        PUNTI
      </h2>
      {settings.status === 'loading' && <StatusView kind="loading" />}
      {settings.status === 'error' && (
        <StatusView kind="error" title="Impostazioni non caricate" onRetry={retry} />
      )}
      {settings.status === 'ready' && (
        <>
          <p className={styles.ratio}>
            1 punto ogni {formatCents(settings.settings.centsPerPoint)} di spesa
          </p>
          <p className={styles.hint}>Il rapporto lo decide un amministratore.</p>
        </>
      )}
    </section>
  );
}

/** Last element of /impostazioni, for operators only (cross-review.md §1, item 7). */
export function OperatorFinalNote() {
  const operator = useCurrentOperator();
  if (operator.role !== 'operator') return null;
  return (
    <p className={styles.note}>
      Operatori, premi, esportazioni e annullamenti dei movimenti li gestiscono gli amministratori.
    </p>
  );
}
