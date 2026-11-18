import { useRef } from 'react';
import { AppShell } from '../../app/AppShell';
import { ButtonLink } from '../../shared/ui/Button';
import { StatusView } from '../../shared/ui/StatusView';
import { formatInteger } from '../../shared/format';
import { loadErrorText } from '../customers/loadErrorText';
import { useCurrentOperator } from '../identity/AuthProvider';
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

function pointsText(points: number): string {
  return `${formatInteger(points)} ${points === 1 ? 'punto' : 'punti'}`;
}

/**
 * One reward of the catalogue (wireframe "Catalogo premi"): its own row, not a `ListRow`, so the
 * Attivo box is not nested inside a link or a button. The box only shows the state for now.
 */
function RewardItem({ reward }: { reward: Reward }) {
  return (
    <li className={styles.item} data-inactive={reward.active ? undefined : 'true'}>
      <span className={styles.text}>
        <span className={styles.name} data-reward-name>
          {reward.name}
        </span>
        <span className={styles.points}>
          {reward.active
            ? pointsText(reward.points)
            : `${pointsText(reward.points)} · non visibile alla cassa né al cliente`}
        </span>
      </span>
      <label className={styles.active}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={reward.active}
          readOnly
          aria-label={`${reward.name} attivo`}
        />
        Attivo
      </label>
    </li>
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
          <RewardItem key={reward.id} reward={reward} />
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
