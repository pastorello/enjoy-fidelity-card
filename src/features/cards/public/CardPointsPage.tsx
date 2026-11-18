import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { formatInteger } from '../../../shared/format';
import { Icon } from '../../../shared/ui/Icon';
import { StatusView } from '../../../shared/ui/StatusView';
import { fetchCardPoints, isCardToken } from './cardPointsService';
import styles from './CardPointsPage.module.css';

// The customer's page behind the link on the card (/s/:token, boards "Saldo-punti" and
// "Saldo-card-non-attiva"). Public: no account, no AuthProvider, no card reading, no link to the
// operators' screens. The token stays in the path: never stored, logged, or put in the title.

type Load =
  | { status: 'loading' }
  | { status: 'points'; points: number }
  | { status: 'inactive' }
  | { status: 'error' };

/** The answer for one token; an answer for another token (or none yet) reads as loading. */
type Answer = { token: string; load: Load };

function useCardPoints(token: string): { load: Load; retry: () => void } {
  const valid = isCardToken(token);
  const [answer, setAnswer] = useState<Answer>();
  // Only the latest request may answer: a retry or a new token makes older ones stale.
  const latest = useRef(0);

  const request = useCallback((wanted: string) => {
    latest.current += 1;
    const id = latest.current;
    const settle = (load: Load) => {
      if (latest.current === id) setAnswer({ token: wanted, load });
    };
    fetchCardPoints(wanted).then(
      (points) => settle(points === null ? { status: 'inactive' } : { status: 'points', points }),
      () => settle({ status: 'error' }),
    );
  }, []);

  useEffect(() => {
    if (!valid) return undefined;
    request(token);
    return () => {
      latest.current += 1;
    };
  }, [token, valid, request]);

  const retry = () => {
    setAnswer(undefined);
    request(token);
  };

  // A malformed token is shown like any link without points, without asking the server.
  if (!valid) return { load: { status: 'inactive' }, retry };
  return { load: answer?.token === token ? answer.load : { status: 'loading' }, retry };
}

export function CardPointsPage() {
  const { token = '' } = useParams();
  const { load, retry } = useCardPoints(token);

  return (
    <div className={styles.page}>
      {/* React places it in <head>, for as long as the page is shown. */}
      <meta name="robots" content="noindex, nofollow" />
      <main className={styles.main}>
        <div className={styles.brand}>
          <img
            className={styles.logo}
            src="/brand/enjoy-badge-green.png"
            alt="Bar Enjoy Gaeta"
            width={125}
            height={120}
          />
        </div>
        {/* The page has its own document: before the panel's own h1, a hidden one names it. */}
        {(load.status === 'loading' || load.status === 'error') && (
          <h1 className="visually-hidden">I tuoi punti Enjoy</h1>
        )}
        {load.status === 'loading' && <StatusView kind="loading" label="Carico i tuoi punti…" />}
        {load.status === 'error' && (
          <div className={styles.status}>
            <StatusView
              kind="error"
              title="Non riesco a caricare i punti."
              description="Controlla la connessione."
              onRetry={retry}
            />
          </div>
        )}
        {load.status === 'points' && <PointsPanel points={load.points} />}
        {load.status === 'inactive' && <InactivePanel />}
      </main>
      <footer className={styles.footer}>
        <p>Enjoy Bar · Gaeta</p>
      </footer>
    </div>
  );
}

function PointsPanel({ points }: { points: number }) {
  return (
    <>
      <section aria-labelledby="card-points-title" className={styles.pointsPanel}>
        <h1 id="card-points-title" lang="en" className={styles.pointsTitle}>
          ENJOY YOUR POINTS
        </h1>
        <p className={styles.balance}>
          <span className={styles.figure}>{formatInteger(points)}</span>{' '}
          <span className={styles.unit}>{points === 1 ? 'punto' : 'punti'}</span>
        </p>
      </section>
      <div className={styles.text}>
        <p className={styles.hint}>Mostra la card alla cassa per usare i tuoi punti.</p>
        <p className={styles.note}>
          Questa pagina mostra solo i punti della card, senza dati personali.
        </p>
      </div>
    </>
  );
}

function InactivePanel() {
  return (
    <section aria-labelledby="card-points-title" className={styles.inactivePanel}>
      <Icon name="credit-card" size={48} className={styles.inactiveIcon} />
      <h1 id="card-points-title" className={styles.inactiveTitle}>
        Card non attiva
      </h1>
      <p>Questa card non mostra punti. Chiedi al bar.</p>
    </section>
  );
}
