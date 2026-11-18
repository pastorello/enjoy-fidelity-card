import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ServerFaultError } from '../../lib/serverFault';
import { formatInteger } from '../../shared/format';
import { Icon } from '../../shared/ui/Icon';
import { useAuth } from '../identity/AuthProvider';
import styles from './RewardRow.module.css';
import { useRewardsService } from './RewardsServiceProvider';
import type { Reward, RewardWriteResult } from './types';
import { writeErrorText } from './writeErrorText';

function pointsText(points: number): string {
  return `${formatInteger(points)} ${points === 1 ? 'punto' : 'punti'}`;
}

type Failure = { text: string; network: boolean };

/**
 * One reward of the catalogue (wireframe "Catalogo premi"): its own row, not a `ListRow`, so the
 * Attivo box is not nested inside a link or a button. Tapping the box saves at once
 * (docs/specs/SPEC-rewards.md §2): the box shows the new state and is disabled until the answer;
 * a success puts the saved row in its place (`onSaved`) and reloads the list, a failure brings
 * the box back and says why under the row. Either way the focus stays on the box, also after the
 * row moved.
 */
export function RewardRow({
  reward,
  onSaved,
  onReload,
}: {
  reward: Reward;
  onSaved: (reward: Reward) => void;
  onReload: () => void;
}) {
  const service = useRewardsService();
  const { reportNotEnabled } = useAuth();
  const [pending, setPending] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<Failure>();
  // A double tap reaches the handler twice before the disabled state renders.
  const saving = useRef(false);
  const box = useRef<HTMLInputElement>(null);
  const errorId = useId();

  // After the answer: a disabled box, or a row React moved, may have lost the focus. It goes
  // back to the box, unless the user has meanwhile moved it somewhere else on purpose.
  const [focusRequest, setFocusRequest] = useState<object>();
  useLayoutEffect(() => {
    if (!focusRequest || !box.current) return;
    const current = document.activeElement;
    if (current === null || current === document.body || current === box.current) {
      box.current.focus();
    }
  }, [focusRequest]);

  async function toggle(active: boolean) {
    if (saving.current) return;
    saving.current = true;
    setPending(active);
    setFailure(undefined);
    let result: RewardWriteResult | { ok: false; error: unknown };
    try {
      result = await service.setActive(reward.id, active);
    } catch (error) {
      result = { ok: false, error };
    }
    saving.current = false;
    setPending(null);
    setFocusRequest({});

    if (result.ok) {
      onSaved(result.reward);
      // Other administrators may have changed the catalogue meanwhile.
      onReload();
      return;
    }
    const { error } = result;
    setFailure({ text: writeErrorText(error), network: error === 'network' });
    // The role may have changed or the profile gone: AuthProvider checks again and either
    // switches the page to the permission message or goes back to /accedi.
    if (error === 'forbidden') {
      void reportNotEnabled();
      return;
    }
    // Nothing changed on a lost connection, and a server fault passes on its own; any other
    // refusal (`not-found`, `unknown`) means this list is not what the server has.
    if (error !== 'network' && !(error instanceof ServerFaultError)) onReload();
  }

  const checked = pending ?? reward.active;

  return (
    <li className={styles.item} data-inactive={reward.active ? undefined : 'true'}>
      <div className={styles.main}>
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
            ref={box}
            type="checkbox"
            className={styles.checkbox}
            checked={checked}
            disabled={pending !== null}
            onChange={(event) => void toggle(event.currentTarget.checked)}
            aria-label={`${reward.name} attivo`}
            aria-describedby={failure ? errorId : undefined}
          />
          Attivo
        </label>
      </div>
      {failure && (
        <p id={errorId} role="alert" className={styles.failure}>
          <Icon name={failure.network ? 'wifi-off' : 'circle-alert'} size={20} />
          {failure.text}
        </p>
      )}
    </li>
  );
}
