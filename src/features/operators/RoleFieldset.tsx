import { useId } from 'react';
import { Icon } from '../../shared/ui/Icon';
import type { Role } from '../identity/types';
import styles from './RoleFieldset.module.css';

const OPTIONS = [
  { value: 'operator', label: 'Operatore' },
  { value: 'admin', label: 'Amministratore' },
] as const satisfies readonly { value: Role; label: string }[];

type RoleFieldsetProps = {
  /** Groups the two radios; unique on the page. */
  name: string;
  value: Role;
  onChange: (role: Role) => void;
  /** "Amministratore" cannot be chosen (a device): the note says why. */
  adminDisabled?: boolean;
  /** Shown under the radios and describing the group, e.g. "Un amministratore si nomina dal telefono." */
  note?: string | undefined;
  /** Why the server refused the role (`admin_from_device`), under the radios; describes the group. */
  error?: string | null | undefined;
};

/**
 * The `fieldset` "Ruolo" of the wireframe "Operatori" (radios "Operatore" / "Amministratore"), the
 * same in the invite form and in the person dialog. Labels are 48 px targets.
 */
export function RoleFieldset({
  name,
  value,
  onChange,
  adminDisabled = false,
  note,
  error,
}: RoleFieldsetProps) {
  const noteId = useId();
  const errorId = useId();
  const describedBy = [error && errorId, note && noteId].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className={styles.fieldset} aria-describedby={describedBy}>
      <legend className={styles.legend}>Ruolo</legend>
      <div className={styles.options}>
        {OPTIONS.map((option) => {
          const disabled = adminDisabled && option.value === 'admin';
          return (
            <label
              key={option.value}
              className={styles.option}
              data-disabled={disabled || undefined}
            >
              <input
                type="radio"
                name={name}
                className={styles.radio}
                value={option.value}
                checked={value === option.value}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
      {error && (
        <p id={errorId} role="alert" className={styles.error}>
          <Icon name="circle-alert" size={18} />
          {error}
        </p>
      )}
      {note && (
        <p id={noteId} className={styles.note}>
          {note}
        </p>
      )}
    </fieldset>
  );
}
