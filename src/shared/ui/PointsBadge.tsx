import { formatInteger, formatPoints } from '../format';
import styles from './PointsBadge.module.css';

type PointsBadgeProps = {
  points: number;
  /** Spoken before the value, e.g. "Saldo". */
  label?: string;
  /**
   * "pt" (default): "45 pt" on screen, "45 punti" for screen readers. "words": "45 punti" on screen
   * too, for readers who may not know the abbreviation (the customer's public page).
   */
  unit?: 'pt' | 'words';
};

function inWords(points: number, digits: string): string {
  return `${digits} ${Math.abs(points) === 1 ? 'punto' : 'punti'}`;
}

export function PointsBadge({ points, label, unit = 'pt' }: PointsBadgeProps) {
  if (unit === 'words') {
    return (
      <span className={styles.badge}>
        {label && <span className="visually-hidden">{`${label}: `}</span>}
        {inWords(points, formatInteger(points))}
      </span>
    );
  }
  const spoken = inWords(points, points.toLocaleString('it-IT'));
  return (
    <span className={styles.badge}>
      <span aria-hidden="true">{formatPoints(points)}</span>
      <span className="visually-hidden">{label ? `${label}: ${spoken}` : spoken}</span>
    </span>
  );
}
