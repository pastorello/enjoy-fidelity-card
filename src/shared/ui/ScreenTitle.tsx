import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import styles from './ScreenTitle.module.css';

type ScreenTitleProps = {
  children: ReactNode;
  /**
   * Focus the heading when it mounts. For a view that replaces the focused control (a form
   * swapped for a result): without it focus falls to the body and a screen reader says nothing.
   */
  focusOnMount?: boolean;
};

/** The one level-1 heading of a screen. */
export function ScreenTitle({ children, focusOnMount = false }: ScreenTitleProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);

  return (
    <h1 ref={heading} tabIndex={focusOnMount ? -1 : undefined} className={styles.title}>
      {children}
    </h1>
  );
}
