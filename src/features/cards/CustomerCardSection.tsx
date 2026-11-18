import { useEffect, useId, useRef, useState } from 'react';
import { ServerFaultError } from '../../lib/serverFault';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { Icon } from '../../shared/ui/Icon';
import { StatusView } from '../../shared/ui/StatusView';
import { loadErrorText } from '../customers/loadErrorText';
import type { CustomerSummary } from '../customers/types';
import { useAuth } from '../identity/AuthProvider';
import { useCardsService } from './CardsServiceProvider';
import styles from './CustomerCardSection.module.css';
import { formatCardLabel, formatCardSince, shortName } from './formatCard';
import { CardsError, NetworkError, type CardSummary } from './types';
import { useActiveCard } from './useActiveCard';

/** Why the deactivation got no answer, or an unexpected one: the dialog stays open with «Riprova». */
function deactivateErrorText(error: unknown): string {
  if (error instanceof ServerFaultError) return `Card non disattivata. ${loadErrorText(error)}`;
  if (error instanceof NetworkError) return 'Card non disattivata: controlla la connessione.';
  return 'Card non disattivata: riprova.';
}

/** Errors whose outcome is unknown: sending the same request again is safe (it is idempotent). */
function isUncertain(error: unknown): boolean {
  return !(error instanceof CardsError) || error.kind === 'network' || error.kind === 'unknown';
}

/**
 * CARD of Modifica cliente (SPEC-cards, point 5; wireframe "Modifica cliente"), before DATI DEL
 * CLIENTE: the active card with «Sostituisci card» and «Disattiva card», or «Nessuna card attiva»
 * with «Associa card». The card is saved on its own, never with the form; a card that cannot be
 * loaded leaves the rest of the form usable. The state of the link comes with task 19.
 */
export function CustomerCardSection({ customer }: { customer: CustomerSummary }) {
  const load = useActiveCard(customer.id);
  const headingId = useId();
  // The card deactivated from here: the section shows no card without loading again.
  const [deactivatedId, setDeactivatedId] = useState<string | null>(null);

  let body;
  if (load.status === 'loading') {
    body = <StatusView kind="loading" label="Caricamento della card…" />;
  } else if (load.status === 'error') {
    body = (
      <div role="alert" className={styles.failure}>
        <p className={styles.row}>
          <Icon name="circle-alert" size={24} className={styles.failureIcon} />
          Card non caricata
        </p>
        <p className={styles.help}>{loadErrorText(load.error)}</p>
        <Button variant="secondary" block onClick={load.retry}>
          Riprova
        </Button>
      </div>
    );
  } else if (load.card === null || load.card.id === deactivatedId) {
    body = <NoCard customerId={customer.id} focus={deactivatedId !== null} />;
  } else {
    body = (
      <ActiveCard
        card={load.card}
        customer={customer}
        onDeactivated={() => setDeactivatedId(load.card?.id ?? null)}
      />
    );
  }

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.title}>
        CARD
      </h2>
      {body}
    </section>
  );
}

/** «Nessuna card attiva» and «Associa card»; it takes the focus after a deactivation from here. */
function NoCard({ customerId, focus }: { customerId: string; focus: boolean }) {
  const text = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focus) text.current?.focus();
  }, [focus]);
  return (
    <>
      <p ref={text} tabIndex={-1} className={`${styles.row} ${styles.none}`}>
        <Icon name="credit-card" size={24} />
        Nessuna card attiva
      </p>
      <ButtonLink to={`/clienti/${customerId}/card`} variant="secondary" block>
        Associa card
      </ButtonLink>
    </>
  );
}

function ActiveCard({
  card,
  customer,
  onDeactivated,
}: {
  card: CardSummary;
  customer: CustomerSummary;
  onDeactivated: () => void;
}) {
  const service = useCardsService();
  const { reportNotEnabled } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set synchronously, so a second tap in the same frame is ignored before `busy` renders.
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const label = formatCardLabel(card.uid);
  const name = shortName(customer.name);

  async function deactivate() {
    try {
      await service.deactivate(card.id);
      onDeactivated();
      return;
    } catch (failure) {
      if (failure instanceof CardsError && failure.kind === 'not_operator') {
        void reportNotEnabled();
      } else if (isUncertain(failure)) {
        setError(deactivateErrorText(failure));
      } else {
        // The card is gone or no longer active (another operator): it has no card to deactivate.
        onDeactivated();
        return;
      }
    }
    sending.current = false;
    setBusy(false);
  }

  function confirm() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    void deactivate();
  }

  return (
    <>
      <p className={styles.row}>
        <Icon name="credit-card" size={24} />
        <span>
          Card attiva {label}{' '}
          <span className={styles.since}>· {formatCardSince(card.associatedAt)}</span>
        </span>
      </p>
      <div className={styles.actions}>
        <ButtonLink to={`/clienti/${customer.id}/card`} variant="secondary">
          Sostituisci card
        </ButtonLink>
        <Button
          variant="danger-secondary"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          Disattiva card
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        tone="danger"
        title={
          <>
            Disattivare la card <span className={styles.label}>{label}</span>?
          </>
        }
        description={`La card non aprirà più la scheda di ${name} e il suo link non mostrerà più i punti. I punti restano a ${name}.`}
        confirmLabel={error === null ? 'Disattiva card' : 'Riprova'}
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => {
          if (sending.current) return;
          setOpen(false);
          setError(null);
        }}
      />
    </>
  );
}
