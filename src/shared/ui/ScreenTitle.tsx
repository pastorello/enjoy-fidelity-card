import type { ReactNode } from 'react';
import styles from './ScreenTitle.module.css';

/** The one level-1 heading of a screen. */
export function ScreenTitle({ children }: { children: ReactNode }) {
  return <h1 className={styles.title}>{children}</h1>;
}
