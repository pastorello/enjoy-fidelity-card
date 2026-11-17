import { formatPoints } from '../format';
import styles from './PointsBadge.module.css';

type PointsBadgeProps = {
  points: number;
  /** Spoken before the value, e.g. "Saldo". */
  label?: string;
};

export function PointsBadge({ points, label }: PointsBadgeProps) {
  const spoken = `${points.toLocaleString('it-IT')} ${Math.abs(points) === 1 ? 'punto' : 'punti'}`;
  return (
    <span className={styles.badge}>
      <span aria-hidden="true">{formatPoints(points)}</span>
      <span className="visually-hidden">{label ? `${label}: ${spoken}` : spoken}</span>
    </span>
  );
}
