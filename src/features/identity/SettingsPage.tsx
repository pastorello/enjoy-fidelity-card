import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { Button } from '../../shared/ui/Button';
import { ListRow } from '../../shared/ui/ListRow';
import { NavigationNotice } from '../customers/NavigationNotice';
import { ExportSection } from '../export/ExportSection';
import { RewardsSettingsSection } from '../rewards/RewardsSettingsSection';
import { OperatorFinalNote, PointsSettingsSection } from '../settings/PointsSettingsSection';
import { DisconnectTabletButton } from '../tablet-kiosk/DisconnectTabletButton';
import { useKioskService } from '../tablet-kiosk/KioskServiceProvider';
import { useAuth, useCurrentOperator, useDevice } from './AuthProvider';
import { roleLabel } from './types';
import styles from './SettingsPage.module.css';

/**
 * Wireframes "Impostazioni" and "Impostazioni operatore". Section order is fixed in
 * docs/specs/cross-review.md: account box · PUNTI (settings) · ACCOUNT · GESTIONE (rewards) ·
 * LETTORE CARD (tablet-kiosk) · ESPORTA DATI (export) · final note (settings).
 *
 * On the till tablet (SPEC-tablet-kiosk, point 12; wireframe "Tablet: impostazioni") the account
 * box shows the cashier and "Esci" ends the turn (`end_cashier_turn`) and opens /cassa, whatever
 * the answer, as "Cambia" does: the tablet stays signed in. ACCOUNT is not there: "Cambia password"
 * would change the bar account's password, and a PIN is set only from one's own phone (point 7).
 */
export function SettingsPage() {
  const operator = useCurrentOperator();
  const { state, signOut } = useAuth();
  const device = useDevice();
  const kiosk = useKioskService();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  // Set synchronously, so a second tap in the same frame sends nothing more.
  const leaving = useRef(false);

  async function handleExit() {
    if (leaving.current) return;
    leaving.current = true;
    setBusy(true);
    if (device) {
      await kiosk.endTurn().catch(() => undefined);
      await navigate('/cassa', { replace: true });
      return;
    }
    await signOut();
    await navigate('/accedi', { replace: true });
  }

  return (
    <AppShell title="Impostazioni" backTo="/">
      <section aria-label="Account" className={styles.account}>
        <span aria-hidden="true" className={styles.avatar}>
          {operator.name.trim().charAt(0).toLocaleUpperCase('it-IT')}
        </span>
        <span className={styles.who}>
          <span className={styles.name}>{operator.name}</span>
          <span className={styles.role}>{roleLabel(operator.role)}</span>
        </span>
        <Button variant="secondary" busy={busy} onClick={() => void handleExit()}>
          Esci
        </Button>
        <DisconnectTabletButton />
      </section>
      <PointsSettingsSection />
      {!device && (
        <section aria-labelledby="settings-account" className={styles.section}>
          <h2 id="settings-account" className={styles.sectionTitle}>
            ACCOUNT
          </h2>
          <ul className={styles.list}>
            {/* The email is read from the session by the next page, never passed in the URL. */}
            <ListRow
              to="/password-dimenticata"
              title="Cambia password"
              subtitle="Ricevi un link via email"
            />
            {/* Only an operator's own phone sets a PIN: never on the till tablet (SPEC-tablet-kiosk, 7). */}
            {state.status === 'signed-in' && (
              <ListRow
                to="/impostazioni/pin"
                title="PIN della cassa"
                subtitle={state.hasPin ? 'Impostato' : 'Da impostare'}
              />
            )}
          </ul>
          {/* "PIN salvato." after /impostazioni/pin, once, inside the section (cross-review §1 order). */}
          <NavigationNotice />
        </section>
      )}
      <RewardsSettingsSection />
      <ExportSection />
      <OperatorFinalNote />
    </AppShell>
  );
}
