import { useId, type InputHTMLAttributes } from 'react';
import { Icon } from './Icon';
import styles from './TextField.module.css';

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Short help under the field. */
  hint?: string;
  /** Says what is wrong and what to do; marks the field invalid. */
  error?: string;
  type?: 'text' | 'tel' | 'email' | 'password';
};

export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  type = 'text',
  className,
  ...rest
}: TextFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        {...rest}
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
      />
      {error ? (
        <p id={messageId} className={styles.error}>
          <Icon name="circle-alert" size={18} />
          {error}
        </p>
      ) : (
        hint && (
          <p id={messageId} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}
