import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { Button } from '../../shared/ui/Button';
import { ListRow } from '../../shared/ui/ListRow';
import { OperatorFinalNote, PointsSettingsSection } from '../settings/PointsSettingsSection';
import { useAuth, useCurrentOperator } from './AuthProvider';
import { roleLabel } from './types';
import styles from './SettingsPage.module.css';

/**
 * Wireframes "Impostazioni" and "Impostazioni operatore". Section order is fixed in
 * docs/specs/cross-review.md: account box · PUNTI (settings) · ACCOUNT · GESTIONE (rewards) ·
 * LETTORE CARD (tablet-kiosk) · ESPORTA DATI (export) · final note (settings).
 */
export function SettingsPage() {
  const operator = useCurrentOperator();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
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
        <Button variant="secondary" busy={busy} onClick={() => void handleSignOut()}>
          Esci
        </Button>
      </section>
      <PointsSettingsSection />
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
        </ul>
      </section>
      <OperatorFinalNote />
    </AppShell>
  );
}
