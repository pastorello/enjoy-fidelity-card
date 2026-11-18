import { useRef, useState } from 'react';
import { AppShell } from '../../app/AppShell';
import { ButtonLink } from '../../shared/ui/Button';
import { StatusView } from '../../shared/ui/StatusView';
import { loadErrorText } from '../customers/loadErrorText';
import { useCurrentOperator } from '../identity/AuthProvider';
import { RewardForm } from './RewardForm';
import { RewardRow } from './RewardRow';
import styles from './RewardsCatalogPage.module.css';
import { useRewards } from './RewardsServiceProvider';
import type { Reward } from './types';

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

/**
 * The admin's catalogue: loading, error with "Riprova", empty, or the rewards in order; the
 * "Nuovo premio" box fixed at the bottom.
 */
function Catalog() {
  const load = useRewards();
  // Every state renders the same AppShell, so its h1 stays mounted through loading and errors.
  const heading = useRef<HTMLHeadingElement>(null);
  // The reward in the "Modifica premio" box. Looked up in the list, so a row no longer there
  // (after a reload) closes the change and gives back "Nuovo premio".
  const [editingId, setEditingId] = useState<string>();
  const editing =
    load.status === 'done' ? load.rewards.find((reward) => reward.id === editingId) : undefined;

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
          <RewardRow
            key={reward.id}
            reward={reward}
            onSaved={load.apply}
            onReload={load.reload}
            editing={reward.id === editing?.id}
            editLocked={editing !== undefined && reward.id !== editing.id}
            onEdit={() => setEditingId(reward.id)}
          />
        ))}
      </ul>
    );
  }

  // A new reward shows at once in its place; the list is then asked again, as after every write.
  function added(reward: Reward) {
    load.apply(reward);
    load.reload();
  }

  // A changed reward moves to its place, the box goes back to "Nuovo premio", the list is asked again.
  function edited(reward: Reward) {
    load.apply(reward);
    setEditingId(undefined);
    load.reload();
  }

  return (
    <AppShell
      title={TITLE}
      backTo={BACK_TO}
      headingRef={heading}
      actions={
        <RewardForm
          disabled={load.status === 'loading'}
          onAdded={added}
          onReload={load.reload}
          editing={editing}
          onEdited={edited}
          onCancelEdit={() => setEditingId(undefined)}
        />
      }
      actionsTone="raised"
    >
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
