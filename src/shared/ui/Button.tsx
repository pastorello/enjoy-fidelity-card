import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import styles from './Button.module.css';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-secondary';

type CommonProps = {
  variant?: ButtonVariant;
  icon?: IconName;
  /** Stretch to the full width of the container (footer actions). */
  block?: boolean;
  children: ReactNode;
};

type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    type?: 'button' | 'submit';
    /** An operation is in progress: presses are ignored, focus stays on the button. */
    busy?: boolean;
  };

function classNames(block: boolean | undefined, className: string | undefined): string {
  return [styles.button, block ? styles.block : undefined, className].filter(Boolean).join(' ');
}

export function Button({
  variant = 'primary',
  icon,
  block,
  busy = false,
  type = 'button',
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      {...rest}
      type={type}
      data-variant={variant}
      className={classNames(block, className)}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={handleClick}
    >
      {busy ? (
        <Icon name="loader-circle" size={20} className={styles.spinner} />
      ) : (
        icon && <Icon name={icon} size={20} />
      )}
      {children}
    </button>
  );
}

type ButtonLinkProps = CommonProps & Omit<LinkProps, 'children'>;

/** Navigation that looks like a button (e.g. "Nuovo cliente"). */
export function ButtonLink({
  variant = 'primary',
  icon,
  block,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link {...rest} data-variant={variant} className={classNames(block, className)}>
      {icon && <Icon name={icon} size={20} />}
      {children}
    </Link>
  );
}
