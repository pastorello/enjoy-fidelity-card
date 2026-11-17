import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import styles from './StatusView.module.css';

type StatusViewProps =
  | { kind: 'loading'; label?: string }
  | { kind: 'empty'; title: string; description?: string; icon?: IconName }
  | {
      kind: 'error';
      title: string;
      description?: string;
      icon?: IconName;
      onRetry: () => void;
      retryLabel?: string;
    };

/** Loading, empty and error states of a screen or a section. */
export function StatusView(props: StatusViewProps) {
  if (props.kind === 'loading') {
    return (
      <output className={`${styles.centered} ${styles.loading}`}>
        <Icon name="loader-circle" className={styles.spinner} />
        {props.label ?? 'Caricamento…'}
      </output>
    );
  }

  if (props.kind === 'empty') {
    return (
      <section aria-live="polite" className={styles.centered}>
        <Icon name={props.icon ?? 'search'} size={48} className={styles.mutedIcon} />
        <h2 className={styles.title}>{props.title}</h2>
        {props.description && <p className={styles.description}>{props.description}</p>}
      </section>
    );
  }

  return (
    <section role="alert" className={styles.error}>
      <div className={styles.errorHeading}>
        <Icon name={props.icon ?? 'circle-alert'} />
        <h2 className={styles.title}>{props.title}</h2>
      </div>
      {props.description && <p className={styles.errorText}>{props.description}</p>}
      <Button className={styles.retry} onClick={props.onRetry} block>
        {props.retryLabel ?? 'Riprova'}
      </Button>
    </section>
  );
}
