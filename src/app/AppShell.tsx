import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from '../shared/ui/Icon';
import styles from './AppShell.module.css';

type AppShellProps = {
  children: ReactNode;
  /** Screen title in the header, with a back link; without it the header shows the logo. */
  title?: string;
  backTo?: string;
  /** An icon link at the right of the title (e.g. "Modifica cliente"); `label` names it. */
  headerAction?: { label: string; icon: IconName; to: string } | undefined;
  /** Signed-in user: shows the account button. */
  account?: { name: string; to: string };
  /** Main actions of the screen, in the footer. */
  actions?: ReactNode;
  /**
   * When the title does not fit in the header's two lines, repeat it in full as the first line of
   * the content (a customer's name, whose last words may tell namesakes apart).
   */
  repeatCutTitle?: boolean;
};

/**
 * Whether `text`, shown in the element, overflows its clamped box. Measured again when the text
 * changes, on resize and once the fonts have loaded; `undefined` text is never cut.
 */
function useIsCut(ref: RefObject<HTMLElement | null>, text: string | undefined) {
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    let live = true;
    function measure() {
      const element = ref.current;
      if (live) {
        setCut(
          text !== undefined && element !== null && element.scrollHeight > element.clientHeight + 1,
        );
      }
    }
    measure();
    window.addEventListener('resize', measure);
    // The display font loads after the first paint and changes how many words fit.
    void document.fonts?.ready.then(measure);
    return () => {
      live = false;
      window.removeEventListener('resize', measure);
    };
  }, [ref, text]);
  return text !== undefined && cut;
}

/** Common screen frame from the wireframes: green header, content, footer actions. */
export function AppShell({
  children,
  title,
  backTo,
  headerAction,
  account,
  actions,
  repeatCutTitle = false,
}: AppShellProps) {
  const hasBack = title !== undefined && backTo !== undefined;
  const titleRef = useRef<HTMLSpanElement>(null);
  const titleCut = useIsCut(titleRef, repeatCutTitle ? title : undefined);

  return (
    <div className={styles.shell}>
      <header className={[styles.header, hasBack ? styles.withBack : ''].join(' ')}>
        {hasBack && (
          <Link to={backTo} className={styles.iconButton} aria-label="Indietro">
            <Icon name="chevron-left" />
          </Link>
        )}
        <h1 className={styles.heading}>
          {title === undefined ? (
            <img
              className={styles.logo}
              src="/brand/enjoy-lettering-negative.webp"
              alt="Enjoy Card"
              width={86}
              height={28}
            />
          ) : (
            <span ref={titleRef} className={styles.title}>
              {title}
            </span>
          )}
        </h1>
        {headerAction && (
          <Link to={headerAction.to} className={styles.iconButton} aria-label={headerAction.label}>
            <Icon name={headerAction.icon} />
          </Link>
        )}
        {account && (
          <Link
            to={account.to}
            className={styles.iconButton}
            aria-label={`Account e impostazioni: ${account.name}`}
          >
            <span className={styles.avatar} aria-hidden="true">
              {account.name.trim().charAt(0).toLocaleUpperCase('it-IT')}
            </span>
          </Link>
        )}
      </header>
      <main className={styles.main}>
        {/* The heading already gives screen readers the whole title: this copy is for the eyes. */}
        {titleCut && (
          <p className={styles.fullTitle} aria-hidden="true">
            {title}
          </p>
        )}
        {children}
      </main>
      {actions && <footer className={styles.footer}>{actions}</footer>}
    </div>
  );
}
