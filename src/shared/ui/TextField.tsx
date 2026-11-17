import { useId, type InputHTMLAttributes, type Ref } from 'react';
import { Icon } from './Icon';
import styles from './TextField.module.css';

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'> & {
  /** The input element, e.g. to focus the first invalid field of a form. */
  ref?: Ref<HTMLInputElement> | undefined;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Short help under the field. */
  hint?: string | undefined;
  /** Says what is wrong and what to do; marks the field invalid. */
  error?: string | undefined;
  type?: 'text' | 'tel' | 'email' | 'password';
  /** `inline`: label on the left, short right-aligned field on the right (48 px tall). */
  layout?: 'stacked' | 'inline' | undefined;
  /** Unit shown right after the field, e.g. "€". */
  suffix?: string | undefined;
};

export function TextField({
  ref,
  label,
  value,
  onChange,
  hint,
  error,
  type = 'text',
  layout = 'stacked',
  suffix,
  className,
  ...rest
}: TextFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  const inline = layout === 'inline';
  const labelElement = (
    <label htmlFor={id} className={styles.label}>
      {label}
    </label>
  );
  const control = (
    <>
      <input
        {...rest}
        ref={ref}
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </>
  );

  return (
    <div
      className={[styles.field, className].filter(Boolean).join(' ')}
      data-layout={inline ? 'inline' : undefined}
    >
      {inline ? (
        <div className={styles.row}>
          {labelElement}
          {control}
        </div>
      ) : (
        <>
          {labelElement}
          {suffix ? <div className={styles.row}>{control}</div> : control}
        </>
      )}
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
