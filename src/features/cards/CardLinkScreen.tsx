import { useCallback, useEffect, type ReactNode } from 'react';
import { AppShell } from '../../app/AppShell';
import { Icon } from '../../shared/ui/Icon';
import { CardLinkWriter, CardLinkWriterActions } from './CardLinkWriter';
import styles from './CardLinkScreen.module.css';
import { NOT_IN_DISPLAY } from './customerName';
import { CustomerRowLink, type CustomerRow } from './CustomerRowLink';
import { formatCardLabel, shortName } from './formatCard';
import type { CardSummary } from './types';
import { useCardLinkWriter } from './useCardLinkWriter';

/** «Card associata a Maria», the check on green (board "Associa-link"). */
export function Associated({ name }: { name: string }) {
  return (
    <output className={styles.associated}>
      <span className={styles.badge}>
        <Icon name="check" size={18} />
      </span>
      <span className={styles.associatedText}>
        Card associata a{' '}
        {/* A typed name with a glyph Enjoy Display lacks is set in the body font. */}
        {NOT_IN_DISPLAY.test(name) ? <span className={styles.typedName}>{name}</span> : name}
      </span>
    </output>
  );
}

/**
 * «Card …E5F6 riattivata per Maria» (SPEC-customers-v2, point 4), as «Card associata a Maria»: the
 * card label, whose «…» Enjoy Display lacks, in the body font.
 */
export function Reactivated({ uid, name }: { uid: string; name: string }) {
  return (
    <output className={styles.associated}>
      <span className={styles.badge}>
        <Icon name="check" size={18} />
      </span>
      <span className={styles.associatedText}>
        Card <span className={styles.typedName}>{formatCardLabel(uid)}</span> riattivata per{' '}
        {NOT_IN_DISPLAY.test(name) ? <span className={styles.typedName}>{name}</span> : name}
      </span>
    </output>
  );
}

type CardLinkScreenProps = {
  title: string;
  /** «Indietro»: where the screen goes once left (the card is associated already). */
  backTo: string;
  customer: CustomerRow;
  card: CardSummary;
  /** What the association did, above the write: hidden with a failure, as in the boards. */
  intro: ReactNode;
  /**
   * Every way out of the write: the link written (true), or «Salta», «Più tardi», a phone that
   * does not write (false). The association is saved either way.
   */
  onLeave: (linkWritten: boolean) => void;
};

/**
 * The write of the link on a card just associated (SPEC-cards, points 2, 3, 4 and 8; boards
 * "Associa-link" and "Associa-link-errore"): the customer row, `intro`, the write and the note on
 * the link, the write's buttons in the footer. A phone that cannot write leaves at once, as «Più
 * tardi» would.
 */
export function CardLinkScreen({
  title,
  backTo,
  customer,
  card,
  intro,
  onLeave,
}: CardLinkScreenProps) {
  const onWritten = useCallback(() => onLeave(true), [onLeave]);
  const writing = useCardLinkWriter({ cardId: card.id, uid: card.uid, onWritten });
  const { state, canWrite } = writing;

  // iPhone, NFC off, the tablet's USB reader, or NFC lost while writing: the outcome of «Più tardi».
  const cannotWrite = state.status === 'cannot-write' || (state.status === 'idle' && !canWrite);
  useEffect(() => {
    if (cannotWrite) onLeave(false);
  }, [cannotWrite, onLeave]);

  const failed = state.status === 'failed';
  const name = shortName(customer.name);
  return (
    <AppShell
      title={title}
      backTo={backTo}
      actions={<CardLinkWriterActions writing={writing} onLater={() => onLeave(false)} />}
    >
      <CustomerRowLink customer={customer} />
      {!failed && intro}
      <CardLinkWriter writing={writing} uid={card.uid} customerName={customer.name} />
      {!failed && (
        <p className={styles.note}>
          <Icon name="link" size={20} />
          <span>
            Con il link, {name} vede i suoi punti avvicinando la card al proprio telefono. Sulla
            card va solo il link: nessun dato personale.
          </span>
        </p>
      )}
    </AppShell>
  );
}
