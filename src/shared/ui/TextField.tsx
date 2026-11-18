import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
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
  /**
   * Says what is wrong and what to do; marks the field invalid. Text, possibly with a link to
   * act on it (e.g. "Apri la scheda" of the customer that already has the name).
   */
  error?: ReactNode;
  /** Help shown under the error, in place of `hint`, while there is one: how to fix it. */
  errorHint?: string | undefined;
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
  errorHint,
  type = 'text',
  layout = 'stacked',
  suffix,
  className,
  ...rest
}: TextFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const errorHintId = `${id}-error-hint`;
  const suffixId = `${id}-suffix`;
  const invalid = error !== undefined && error !== null && error !== false && error !== '';
  const message = invalid || Boolean(hint);
  const withErrorHint = invalid && Boolean(errorHint);
  // The unit is only visible text after the input: screen readers hear it with the description.
  const describedBy =
    [suffix && suffixId, message && messageId, withErrorHint && errorHintId]
      .filter(Boolean)
      .join(' ') || undefined;

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
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      {suffix && (
        <span id={suffixId} className={styles.suffix}>
          {suffix}
        </span>
      )}
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
      {invalid ? (
        <>
          <p id={messageId} className={styles.error}>
            <Icon name="circle-alert" size={18} />
            {/* Text with a link stays one flowing sentence next to the icon. */}
            {typeof error === 'string' ? error : <span>{error}</span>}
          </p>
          {withErrorHint && (
            <p id={errorHintId} className={styles.hint}>
              {errorHint}
            </p>
          )}
        </>
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
