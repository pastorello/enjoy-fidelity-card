import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
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
 * write may be saved already; the button says "Riprova" and resends the same request.
 */
type Failure = { text: string; uncertain: boolean; network: boolean };

function failureOf(error: unknown): Failure {
  const uncertain = error === 'network' || error instanceof ServerFaultError;
  return { text: writeErrorText(error), uncertain, network: error === 'network' };
}

function FailureText({ failure }: { failure: Failure }) {
  return (
    <p role="alert" className={styles.failure}>
      <Icon name={failure.network ? 'wifi-off' : 'circle-alert'} size={20} />
      {failure.text}
    </p>
  );
}

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
function NewReward({
  hidden,
  disabled,
  onAdded,
  onReload,
}: {
  /** While "Modifica premio" takes its place: the box stays mounted, so its draft is kept. */
  hidden: boolean;
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

  // "Premio aggiunto" belongs to the last add: it goes when the box gives way to a change.
  const [wasHidden, setWasHidden] = useState(hidden);
  if (hidden !== wasHidden) {
    setWasHidden(hidden);
    if (hidden) setAdded(false);
  }

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
      setFailure(failureOf(error));
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
    <section aria-labelledby={headingId} className={styles.box} hidden={hidden}>
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
          {failure && <FailureText failure={failure} />}
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

/**
 * The "Modifica premio" box (docs/specs/SPEC-rewards.md §2, not in the wireframe): name and
 * points of `reward` filled in, no Attivo box (it stays in the row), the note on the history,
 * "Salva modifiche" and "Annulla". The focus goes to the name when it opens. Same checks and
 * failures as "Nuovo premio"; a resend after no answer is safe as it is, since `update` sets
 * values and adds nothing. A success hands the saved row to `onSaved`.
 */
function EditReward({
  reward,
  onSaved,
  onCancel,
  onReload,
}: {
  reward: Reward;
  onSaved: (reward: Reward) => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const service = useRewardsService();
  const { reportNotEnabled } = useAuth();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [failure, setFailure] = useState<Failure>();
  const [values, setValues] = useState<RewardFormValues>(() => ({
    name: reward.name,
    points: String(reward.points),
  }));
  const [errors, setErrors] = useState<RewardFormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const noteId = useId();

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function change(key: keyof RewardFormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
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
      result = await service.update(reward.id, checked.reward);
    } catch (error) {
      result = { ok: false, error };
    }
    sending.current = false;
    setBusy(false);

    if (result.ok) {
      onSaved(result.reward);
      return;
    }
    const { error } = result;
    if (error === 'name-taken') {
      setErrors({ name: writeErrorText(error) });
      nameRef.current?.focus();
      return;
    }
    setFailure(failureOf(error));
    if (error === 'forbidden') void reportNotEnabled();
    else if (error === 'not-found' || error === 'unknown') onReload();
  }

  return (
    <section aria-labelledby={headingId} className={styles.box}>
      <h2 id={headingId} className={styles.title}>
        Modifica premio
      </h2>
      <form noValidate onSubmit={(event) => void handleSubmit(event)}>
        <fieldset className={styles.fields} aria-describedby={noteId}>
          <TextField
            ref={nameRef}
            label="Nome del premio"
            value={values.name}
            onChange={(value) => change('name', value)}
            error={errors.name}
            autoComplete="off"
            autoCapitalize="sentences"
          />
          <TextField
            ref={pointsRef}
            label="Punti richiesti"
            inputMode="numeric"
            value={values.points}
            onChange={(value) => change('points', value)}
            error={errors.points}
            autoComplete="off"
          />
          <p id={noteId} className={styles.note}>
            Nome e punti valgono per i riscatti da ora in poi: i riscatti già registrati non
            cambiano.
          </p>
          {failure && <FailureText failure={failure} />}
          <div className={styles.actions}>
            <Button type="submit" block busy={busy}>
              {failure?.uncertain ? 'Riprova' : 'Salva modifiche'}
            </Button>
            <Button variant="secondary" block onClick={onCancel}>
              Annulla
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

/**
 * The box at the bottom of the catalogue: "Nuovo premio", or "Modifica premio" while `editing`
 * is set. The "Nuovo premio" box stays mounted meanwhile, hidden, so its draft, its id and its
 * last failure are there again after "Salva modifiche" or "Annulla".
 */
export function RewardForm({
  disabled,
  onAdded,
  onReload,
  editing,
  onEdited,
  onCancelEdit,
}: {
  /** While the catalogue loads. */
  disabled: boolean;
  onAdded: (reward: Reward) => void;
  /** Asks the list again after a refusal that means it is not what the server has. */
  onReload: () => void;
  /** The reward being changed, if any. */
  editing: Reward | undefined;
  onEdited: (reward: Reward) => void;
  onCancelEdit: () => void;
}) {
  return (
    <>
      <NewReward
        hidden={editing !== undefined}
        disabled={disabled}
        onAdded={onAdded}
        onReload={onReload}
      />
      {editing && (
        <EditReward
          key={editing.id}
          reward={editing}
          onSaved={onEdited}
          onCancel={onCancelEdit}
          onReload={onReload}
        />
      )}
    </>
  );
}
