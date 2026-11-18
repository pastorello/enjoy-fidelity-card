import { useId, useRef, type InputHTMLAttributes, type Ref } from 'react';
import { Icon } from './Icon';
import styles from './SearchField.module.css';
import fieldStyles from './TextField.module.css';

type SearchFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'id' | 'type'
> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  ref?: Ref<HTMLInputElement> | undefined;
};

export function SearchField({ label, value, onChange, className, ref, ...rest }: SearchFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // The input goes both to the clear button's ref and to the caller's.
  function setInput(node: HTMLInputElement | null) {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }

  function clear() {
    onChange('');
    inputRef.current?.focus();
  }

  return (
    <div className={[fieldStyles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={fieldStyles.label}>
        {label}
      </label>
      <div className={styles.box}>
        <Icon name="search" className={styles.icon} />
        <input
          {...rest}
          ref={setInput}
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${fieldStyles.input} ${styles.input}`}
          autoComplete="off"
          enterKeyHint="search"
        />
        {value !== '' && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Cancella la ricerca"
            onClick={clear}
          >
            <Icon name="x" size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
