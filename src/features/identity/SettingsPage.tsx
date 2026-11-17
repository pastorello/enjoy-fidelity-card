import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { Button } from '../../shared/ui/Button';
import { useAuth, useCurrentOperator } from './AuthProvider';
import { roleLabel } from './types';
import styles from './SettingsPage.module.css';

/**
 * Wireframes "Impostazioni" and "Impostazioni operatore". V1 has only the account box; the
 * settings, rewards and export modules add their sections here.
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
    </AppShell>
  );
}
