import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from '../shared/ui/Icon';
import styles from './AppShell.module.css';

type AppShellProps = {
  children: ReactNode;
  /** Screen title in the header, with a back link; without it the header shows the logo. */
  title?: string;
  backTo?: string;
  /** Signed-in user: shows the account button. */
  account?: { name: string; to: string };
  /** Main actions of the screen, in the footer. */
  actions?: ReactNode;
};

/** Common screen frame from the wireframes: green header, content, footer actions. */
export function AppShell({ children, title, backTo, account, actions }: AppShellProps) {
  const hasBack = title !== undefined && backTo !== undefined;

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
            <span className={styles.title}>{title}</span>
          )}
        </h1>
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
      <main className={styles.main}>{children}</main>
      {actions && <footer className={styles.footer}>{actions}</footer>}
    </div>
  );
}
