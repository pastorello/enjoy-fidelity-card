import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { Icon } from '../../shared/ui/Icon';
import { ServerFaultError } from '../../lib/serverFault';
import { homeNoticeState } from '../customers/homeNotice';
import { loadErrorText } from '../customers/loadErrorText';
import { useAuth } from '../identity/AuthProvider';
import { useKioskService } from './KioskServiceProvider';
import { PinPad } from './PinPad';
import { KioskError } from './types';
import styles from './PinSettingsPage.module.css';

const PAGE_TITLE = 'PIN della cassa';
/** Shown once in Impostazioni after the save (`useNavigationNotice`). */
export const PIN_SAVED_NOTICE = 'PIN salvato.';

type Failure = 'different' | 'network' | { error: unknown };

function failureText(failure: Failure): string {
  if (failure === 'different') return 'I due PIN sono diversi';
  if (failure === 'network') return 'Connessione assente. Riprova.';
  return failure.error instanceof ServerFaultError
    ? loadErrorText(failure.error)
    : 'PIN non salvato. Riprova.';
}

/**
 * "PIN della cassa" from one's own phone (SPEC-tablet-kiosk, point 7): the PIN is chosen, then
 * repeated, and saved on the server. No old PIN is asked: the phone's session is personal. The
 * digits live only in this page's state: never in the URL, the storage or the navigation state.
 * On the till tablet the page does not exist.
 */
export function PinSettingsPage() {
  const { state, refreshIdentity, reportNotEnabled } = useAuth();
  const kiosk = useKioskService();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  // The first entry while the second is typed; null while choosing.
  const [first, setFirst] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Set once the step has changed: from then on the live region says the current step.
  const [announced, setAnnounced] = useState(false);
  const step = first === null ? 'Scegli il PIN' : 'Ripeti il PIN';

  if (state.status === 'device') return <Navigate to="/" replace />;

  function startAgain(reason: Failure) {
    setAnnounced(true);
    setFirst(null);
    setPin('');
    setFailure(reason);
  }

  function change(next: string) {
    setPin(next);
    if (next !== '') setFailure(null);
  }

  async function save(chosen: string) {
    setSaving(true);
    let result;
    try {
      result = await kiosk.setMyPin(chosen);
    } catch (error) {
      setSaving(false);
      startAgain({ error });
      // Not an operator account any more (42501): the identity check decides where to go.
      if (error instanceof KioskError && error.kind === 'forbidden') void reportNotEnabled();
      return;
    }
    if (result.status === 'network') {
      setSaving(false);
      startAgain('network');
      return;
    }
    // "Impostato" in Impostazioni comes from the identity read again.
    await refreshIdentity();
    await navigate('/impostazioni', { replace: true, state: homeNoticeState(PIN_SAVED_NOTICE) });
  }

  function complete(entered: string) {
    if (first === null) {
      setAnnounced(true);
      setFirst(entered);
      setPin('');
      return;
    }
    if (entered !== first) {
      startAgain('different');
      return;
    }
    void save(entered);
  }

  return (
    <AppShell title={PAGE_TITLE} backTo="/impostazioni">
      <section aria-labelledby="pin-step" className={styles.panel}>
        <PinPad
          heading={
            <h2 id="pin-step" className={styles.step}>
              {step}
            </h2>
          }
          value={pin}
          onChange={change}
          onComplete={complete}
          disabled={saving}
        />
        {/* The heading changes silently and the focus stays on the key: the step is said here. On
            the page from the start, empty until the first change, so TalkBack reads each one. */}
        <p className="visually-hidden" aria-live="polite" data-testid="pin-step-announcer">
          {announced ? step : ''}
        </p>
        {failure && (
          <p role="alert" className={styles.message}>
            <Icon name={failure === 'network' ? 'wifi-off' : 'circle-alert'} size={20} />
            {failureText(failure)}
          </p>
        )}
        <p className={styles.note}>
          Il PIN di 4 cifre serve per metterti alla cassa sul tablet condiviso. Un PIN nuovo chiude
          il tuo turno aperto sul tablet.
        </p>
      </section>
    </AppShell>
  );
}
