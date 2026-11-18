import { useRef } from 'react';
import { AppShell } from '../../app/AppShell';
import { ButtonLink } from '../../shared/ui/Button';
import { StatusView } from '../../shared/ui/StatusView';
import { loadErrorText } from '../customers/loadErrorText';
import { useCurrentOperator } from '../identity/AuthProvider';
import { RewardRow } from './RewardRow';
import styles from './RewardsCatalogPage.module.css';
import { useRewards } from './RewardsServiceProvider';

const TITLE = 'Catalogo premi';
const BACK_TO = '/impostazioni';

/**
 * The permission message for an operator who opens the catalogue URL by hand
 * (docs/specs/SPEC-rewards.md §4): no read and no write is sent, and no "Nuovo premio" box.
 */
function AdminsOnly() {
  return (
    <AppShell
      title={TITLE}
      backTo={BACK_TO}
      actions={
        <ButtonLink to={BACK_TO} variant="secondary" block>
          Torna alle impostazioni
        </ButtonLink>
      }
    >
      <StatusView
        kind="empty"
        icon="lock"
        title="Solo per gli amministratori"
        description="Il catalogo premi lo gestiscono gli amministratori."
      />
    </AppShell>
  );
}

/** The admin's catalogue: loading, error with "Riprova", empty, or the rewards in order. */
function Catalog() {
  const load = useRewards();
  // Every state renders the same AppShell, so its h1 stays mounted through loading and errors.
  const heading = useRef<HTMLHeadingElement>(null);

  // "Riprova" is replaced by the loading state: the focus goes to the title, not to <body>.
  function retry() {
    load.reload();
    heading.current?.focus();
  }

  let content;
  if (load.status === 'loading') {
    content = <StatusView kind="loading" />;
  } else if (load.status === 'error') {
    content = (
      <StatusView
        kind="error"
        title="Catalogo non caricato"
        description={loadErrorText(load.error)}
        onRetry={retry}
      />
    );
  } else if (load.rewards.length === 0) {
    content = (
      <StatusView
        kind="empty"
        icon="gift"
        title="Nessun premio nel catalogo"
        description="Aggiungi il primo premio qui sotto."
      />
    );
  } else {
    content = (
      <ul className={styles.list} aria-label="Premi del catalogo">
        {load.rewards.map((reward) => (
          <RewardRow key={reward.id} reward={reward} onSaved={load.apply} onReload={load.reload} />
        ))}
      </ul>
    );
  }

  return (
    <AppShell title={TITLE} backTo={BACK_TO} headingRef={heading}>
      {content}
    </AppShell>
  );
}

/**
 * Catalogo premi (`/impostazioni/premi`; wireframe "Catalogo premi"): administrators only,
 * reached from the GESTIONE section of the settings.
 */
export function RewardsCatalogPage() {
  const operator = useCurrentOperator();
  if (operator.role !== 'admin') return <AdminsOnly />;
  return <Catalog />;
}
