import type { ReactNode } from 'react';
import styles from './TabletColumns.module.css';

type TabletColumnsProps = {
  /** The screen's content, on the left. */
  children: ReactNode;
  /** What the right column holds. */
  aside: ReactNode;
  /** `data-tablet-column` of the right column, for styles and tests. */
  column: string;
  /** Width of the right column in the wireframes (SPEC-tablet-kiosk, point 10). */
  width: 400 | 440 | 480;
  /** Name of the column; with `labelledBy`, the id of its heading. Neither: a plain column. */
  label?: string;
  labelledBy?: string;
  /** Centre what the column holds vertically (the keypads, the Card panel). */
  centered?: boolean;
};

/**
 * The two-column screens of the till tablet at 1280×800 (SPEC-tablet-kiosk, point 10): the content
 * on the left with 32 px around it, and on the right a raised column of a fixed width (keypad 480,
 * summary 400, Card panel 440, "Nuovo premio" 480), edge to edge under the header. A complementary
 * landmark when it has a name; a plain column when what it holds already names itself.
 */
export function TabletColumns({
  children,
  aside,
  column,
  width,
  label,
  labelledBy,
  centered = false,
}: TabletColumnsProps) {
  const asideProps = {
    className: styles.aside,
    'data-tablet-column': column,
    'data-width': width,
    'data-centered': centered,
  };
  return (
    <div className={styles.layout} data-tablet="true">
      <div className={styles.main} data-tablet-column="main">
        {children}
      </div>
      {label !== undefined || labelledBy !== undefined ? (
        <aside aria-label={label} aria-labelledby={labelledBy} {...asideProps}>
          {aside}
        </aside>
      ) : (
        <div {...asideProps}>{aside}</div>
      )}
    </div>
  );
}
