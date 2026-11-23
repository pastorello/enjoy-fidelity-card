import { useRef, useState } from 'react';
import { AppShell } from '../../app/AppShell';
import { AdminsOnly } from '../../shared/ui/AdminsOnly';
import { StatusView } from '../../shared/ui/StatusView';
import { loadErrorText } from '../customers/loadErrorText';
import { useCurrentOperator } from '../identity/AuthProvider';
import { TabletColumns } from '../tablet-kiosk/TabletColumns';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import { RewardForm } from './RewardForm';
import { RewardRow } from './RewardRow';
import styles from './RewardsCatalogPage.module.css';
import { useRewards } from './RewardsServiceProvider';
import type { Reward } from './types';

const TITLE = 'Catalogo premi';
const BACK_TO = '/impostazioni';

/**
 * The admin's catalogue: loading, error with "Riprova", empty, or the rewards in order; the
 * "Nuovo premio" box fixed at the bottom.
 */
function Catalog() {
  const load = useRewards();
  // Every state renders the same AppShell, so its h1 stays mounted through loading and errors.
  const heading = useRef<HTMLHeadingElement>(null);
  const tablet = useTabletLayout();
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

  const form = (
    <RewardForm
      disabled={load.status === 'loading'}
      onAdded={added}
      onReload={load.reload}
      editing={editing}
      onEdited={edited}
      onCancelEdit={() => setEditingId(undefined)}
    />
  );

  if (tablet) {
    // Wireframe "Tablet: catalogo premi" (SPEC-tablet-kiosk, point 10): the list on the left, the
    // "Nuovo premio" box in the 480 px column on the right, from the top.
    return (
      <AppShell title={TITLE} backTo={BACK_TO} headingRef={heading}>
        <TabletColumns column="new-reward" width={480} aside={form}>
          {content}
        </TabletColumns>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={TITLE}
      backTo={BACK_TO}
      headingRef={heading}
      actions={form}
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
  if (operator.role !== 'admin') {
    // SPEC-rewards §4: no read and no write is sent, and no "Nuovo premio" box.
    return (
      <AdminsOnly title={TITLE} description="Il catalogo premi lo gestiscono gli amministratori." />
    );
  }
  return <Catalog />;
}
