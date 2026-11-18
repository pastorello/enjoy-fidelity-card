import { useId, useRef, useState, type FormEvent } from 'react';
import { ServerFaultError } from '../../lib/serverFault';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { TextField } from '../../shared/ui/TextField';
import { useAuth } from '../identity/AuthProvider';
import styles from './RewardForm.module.css';
import { useRewardsService } from './RewardsServiceProvider';
import type { Reward, RewardWriteResult } from './types';
import { validateReward, type RewardFormErrors, type RewardFormValues } from './validateReward';
import { writeErrorText } from './writeErrorText';

const EMPTY: RewardFormValues = { name: '', points: '' };

/**
 * What went wrong outside the fields. `uncertain`: no answer (network, server fault), so the
 * reward may be saved already; the button says "Riprova" and resends the same id.
 */
type Failure = { text: string; uncertain: boolean; network: boolean };

/**
 * The "Nuovo premio" box fixed at the bottom of the catalogue (wireframe "Catalogo premi";
 * docs/specs/SPEC-rewards.md §2): name, points, Attivo ticked by default, "Aggiungi premio".
 * The app checks the values first (`validateReward`): a wrong form costs no call, its messages
 * go under the fields and the focus to the first wrong one. The id of the new reward is made
 * when the box opens and changes only after a successful save, so a resend creates nothing twice.
 * On success the saved row goes to `onAdded`, the fields empty and "Premio aggiunto" is announced.
 * The button is busy until the answer (a double tap sends once). A failure (§4) keeps the fields:
 * a name already used goes under the name; no answer says so and offers "Riprova" with the same
 * id, and if the first request had arrived the server's row is listed, not the form's values;
 * `not-found`/`unknown` ask the list again; `invalid`, unexpected after the app's check, is told as
 * unknown; `forbidden` is reported to AuthProvider.
 */
export function RewardForm({
  disabled,
  onAdded,
  onReload,
}: {
  /** While the catalogue loads. */
  disabled: boolean;
  onAdded: (reward: Reward) => void;
  /** Asks the list again after a refusal that means it is not what the server has. */
  onReload: () => void;
}) {
  const service = useRewardsService();
  const { reportNotEnabled } = useAuth();
  const [busy, setBusy] = useState(false);
  // Set synchronously, so a second tap in the same frame is ignored before `busy` renders.
  const sending = useRef(false);
  const [failure, setFailure] = useState<Failure>();
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
    if (sending.current) return;
    setAdded(false);
    const checked = validateReward(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      (checked.errors.name !== undefined ? nameRef : pointsRef).current?.focus();
      return;
    }
    setErrors({});
    setFailure(undefined);
    sending.current = true;
    setBusy(true);
    let result: RewardWriteResult | { ok: false; error: unknown };
    try {
      result = await service.create({ id, ...checked.reward, active });
    } catch (error) {
      result = { ok: false, error };
    }
    sending.current = false;
    setBusy(false);

    if (!result.ok) {
      // The id stays: nothing was created, or a resend returns what was.
      const { error } = result;
      if (error === 'name-taken') {
        setErrors({ name: writeErrorText(error) });
        nameRef.current?.focus();
        return;
      }
      const uncertain = error === 'network' || error instanceof ServerFaultError;
      setFailure({ text: writeErrorText(error), uncertain, network: error === 'network' });
      // The role may have changed or the profile gone: AuthProvider checks again.
      if (error === 'forbidden') void reportNotEnabled();
      // This list is not what the server has.
      else if (error === 'not-found' || error === 'unknown') onReload();
      return;
    }
    // A resent id returns the row saved by the first request, whatever the form says now.
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
          {failure && (
            <p role="alert" className={styles.failure}>
              <Icon name={failure.network ? 'wifi-off' : 'circle-alert'} size={20} />
              {failure.text}
            </p>
          )}
          <Button type="submit" block busy={busy}>
            {failure?.uncertain ? 'Riprova' : 'Aggiungi premio'}
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
