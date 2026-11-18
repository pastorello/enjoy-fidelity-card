import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon';
import styles from './ListRow.module.css';

type ListRowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-hand content, e.g. a PointsBadge or an amount. */
  trailing?: ReactNode;
} &
  /** `state`: the navigation state the link carries (React Router `Link` state). */
  (
    | { to: string; state?: unknown; onClick?: never }
    | { onClick: () => void; to?: never; state?: never }
    | { to?: never; onClick?: never; state?: never }
  );

/** One row of a list (render inside <ul>). The whole row is the touch target. */
export function ListRow({ title, subtitle, trailing, to, state, onClick }: ListRowProps) {
  const content = (
    <>
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      {trailing}
      {(to !== undefined || onClick) && (
        <Icon name="chevron-right" size={20} className={styles.chevron} />
      )}
    </>
  );

  let row: ReactNode;
  if (to !== undefined) {
    row = (
      <Link to={to} state={state} className={styles.row}>
        {content}
      </Link>
    );
  } else if (onClick) {
    row = (
      <button type="button" className={styles.row} onClick={onClick}>
        {content}
      </button>
    );
  } else {
    row = <div className={styles.row}>{content}</div>;
  }

  return <li className={styles.item}>{row}</li>;
}
