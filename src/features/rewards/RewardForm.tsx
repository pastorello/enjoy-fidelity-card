import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { TextField } from '../../shared/ui/TextField';
import styles from './RewardForm.module.css';
import { useRewardsService } from './RewardsServiceProvider';
import type { Reward } from './types';
import { validateReward, type RewardFormErrors, type RewardFormValues } from './validateReward';

const EMPTY: RewardFormValues = { name: '', points: '' };

/**
 * The "Nuovo premio" box fixed at the bottom of the catalogue (wireframe "Catalogo premi";
 * docs/specs/SPEC-rewards.md §2): name, points, Attivo ticked by default, "Aggiungi premio".
 * The app checks the values first (`validateReward`): a wrong form costs no call, its messages
 * go under the fields and the focus to the first wrong one. The id of the new reward is made
 * when the box opens and changes only after a successful save, so a resend creates nothing twice.
 * On success the saved row goes to `onAdded`, the fields empty and "Premio aggiunto" is announced.
 */
export function RewardForm({
  disabled,
  onAdded,
}: {
  /** While the catalogue loads. */
  disabled: boolean;
  onAdded: (reward: Reward) => void;
}) {
  const service = useRewardsService();
  const [id, setId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<RewardFormValues>(EMPTY);
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<RewardFormErrors>({});
  const [added, setAdded] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);
  const headingId = useId();

  function change(key: keyof RewardFormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setAdded(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdded(false);
    const checked = validateReward(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      (checked.errors.name !== undefined ? nameRef : pointsRef).current?.focus();
      return;
    }
    setErrors({});
    let result;
    try {
      result = await service.create({ id, ...checked.reward, active });
    } catch {
      // Write failures are told by the next task of the plan (tasks/rewards/todo.md, task 11):
      // until then the fields stay as typed and the same id is resent.
      return;
    }
    if (!result.ok) return;
    onAdded(result.reward);
    setValues(EMPTY);
    setActive(true);
    setId(crypto.randomUUID());
    setAdded(true);
  }

  return (
    <section aria-labelledby={headingId} className={styles.box}>
      <h2 id={headingId} className={styles.title}>
        Nuovo premio
      </h2>
      <form noValidate onSubmit={(event) => void handleSubmit(event)}>
        <fieldset disabled={disabled} className={styles.fields}>
          <TextField
            ref={nameRef}
            label="Nome del premio"
            placeholder="Es. Spremuta"
            value={values.name}
            onChange={(value) => change('name', value)}
            error={errors.name}
            autoComplete="off"
            autoCapitalize="sentences"
          />
          <div className={styles.row}>
            <TextField
              ref={pointsRef}
              className={styles.points}
              label="Punti richiesti"
              placeholder="Es. 80"
              inputMode="numeric"
              value={values.points}
              onChange={(value) => change('points', value)}
              error={errors.points}
              autoComplete="off"
            />
            <label className={styles.active}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={active}
                onChange={(event) => setActive(event.currentTarget.checked)}
              />
              Attivo
            </label>
          </div>
          <Button type="submit" block>
            Aggiungi premio
          </Button>
        </fieldset>
      </form>
      {/* Always in the page, so screen readers announce the text when it appears. */}
      <output aria-live="polite" className={styles.added}>
        {added && (
          <>
            <Icon name="check" size={20} />
            Premio aggiunto
          </>
        )}
      </output>
    </section>
  );
}
