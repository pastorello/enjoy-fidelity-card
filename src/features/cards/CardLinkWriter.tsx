import { useId } from 'react';
import { ServerFaultError } from '../../lib/serverFault';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { loadErrorText } from '../customers/loadErrorText';
import styles from './CardLinkWriter.module.css';
import { firstName } from './customerName';
import { formatCardLabel } from './formatCard';
import { NetworkError } from './types';
import type { CardLinkFailure, CardLinkWriting } from './useCardLinkWriter';

const WRITING_TITLE = 'Tieni la card appoggiata';
const WRITING_TEXT = 'Scrivo il link per vedere i punti…';
const VERIFYING_TITLE = 'Controllo del link: allontana la card e riavvicinala';
const WRITTEN_TEXT =
  'Link scritto: il cliente può vedere i suoi punti avvicinando la card al suo telefono.';
const DEVICE_TEXT = 'Per scrivere il link serve un telefono Android con l’NFC attivo.';
const LATER_HINT = 'Puoi scriverlo anche dopo, da Modifica cliente.';

/** The alert of an outcome that left the card without the link (SPEC-cards, point 8.4). */
type FailureText = { title?: string; text: string; hint?: boolean };

function failureText(failure: CardLinkFailure, uid: string, name: string): FailureText {
  if (failure.kind === 'issue') {
    if (failure.error instanceof NetworkError) {
      return { text: 'Link non scritto: controlla la connessione.' };
    }
    if (failure.error instanceof ServerFaultError) {
      return { text: `Link non scritto. ${loadErrorText(failure.error)}` };
    }
    return { text: 'Link non scritto: riprova.' };
  }
  if (failure.kind === 'confirm') {
    // The wording of a confirmation without answer comes with task 16.
    return { text: 'Link non scritto: riprova.' };
  }
  return WRITE_FAILURES[failure.reason](formatCardLabel(uid), name);
}

/** What each outcome of `writeUrl` without the link says, given the card label and the first name. */
const WRITE_FAILURES: Record<
  Extract<CardLinkFailure, { kind: 'write' }>['reason'],
  (label: string, name: string) => FailureText
> = {
  // Board "Associa-link-errore".
  timeout: (_label, name) => detachedText(name),
  io: (_label, name) => detachedText(name),
  'wrong-card': (label) => ({
    text: `Questa non è la card ${label}: il link non è stato scritto.`,
  }),
  'verify-failed': () => ({ text: 'Il link sulla card non risulta giusto. Riprova.' }),
  'not-allowed': () => ({
    text: 'Il telefono non permette di scrivere la card: controlla il permesso NFC di Chrome.',
  }),
  // Another write still running, or a card whose content cannot be read (task 16).
  busy: () => ({ text: 'Link non scritto: riprova.' }),
  unreadable: () => ({ text: 'Link non scritto: riprova.' }),
};

function detachedText(name: string): FailureText {
  return {
    title: 'Link non scritto',
    text: `La card è associata a ${name} e funziona alla cassa. Il link per vedere i punti non è stato scritto: la card si è staccata troppo presto.`,
    hint: true,
  };
}

type CardLinkWriterProps = {
  writing: CardLinkWriting;
  /** Canonical uid of the card being written. */
  uid: string;
  /** The customer's full name: the alerts call them by first name. */
  customerName: string;
};

/**
 * "Scrittura del link" (SPEC-cards, point 8; boards "Associa-link" and "Associa-link-errore"): the
 * steps of the write, live, then the outcome. Its buttons are `CardLinkWriterActions`, which the
 * screen puts in its footer.
 */
export function CardLinkWriter({ writing, uid, customerName }: CardLinkWriterProps) {
  const titleId = useId();
  const { state, canWrite } = writing;

  if (state.status === 'stopped') return null;

  if (state.status === 'failed') {
    const failure = failureText(state.failure, uid, firstName(customerName));
    return (
      <>
        <section
          role="alert"
          aria-labelledby={failure.title === undefined ? undefined : titleId}
          className={styles.failure}
        >
          <Icon name="circle-alert" size={48} className={styles.failureIcon} />
          {failure.title !== undefined && (
            <h2 id={titleId} className={styles.failureTitle}>
              {failure.title}
            </h2>
          )}
          <p className={styles.failureText}>{failure.text}</p>
        </section>
        {failure.hint === true && <p className={styles.hint}>{LATER_HINT}</p>}
      </>
    );
  }

  let body;
  if (state.status === 'written') {
    body = <output className={styles.written}>{WRITTEN_TEXT}</output>;
  } else if (state.status === 'cannot-write' || (state.status === 'idle' && !canWrite)) {
    body = <p className={styles.text}>{DEVICE_TEXT}</p>;
  } else if (state.status === 'writing' && state.step === 'waiting-card') {
    body = (
      <p className={styles.title}>
        {/* Enjoy Display has no "…": the label is set in the body font. */}
        Avvicina la card <span className={styles.label}>{formatCardLabel(uid)}</span>
      </p>
    );
  } else if (
    state.status === 'confirming' ||
    (state.status === 'writing' && state.step === 'verifying')
  ) {
    body = <p className={styles.title}>{VERIFYING_TITLE}</p>;
  } else {
    body = (
      <>
        <p className={styles.title}>{WRITING_TITLE}</p>
        <p className={styles.progress}>
          <Icon name="loader-circle" size={16} className={styles.spinner} />
          {WRITING_TEXT}
        </p>
      </>
    );
  }

  const off = state.status === 'cannot-write' || (state.status === 'idle' && !canWrite);
  const done = state.status === 'written';
  return (
    <section aria-label="Scrittura del link" className={styles.panel}>
      <Icon
        name={off ? 'nfc-off' : done ? 'check' : 'nfc'}
        size={64}
        className={off ? styles.iconOff : styles.icon}
      />
      <div aria-live="polite" className={styles.texts}>
        {body}
      </div>
    </section>
  );
}

type CardLinkWriterActionsProps = {
  writing: CardLinkWriting;
  /** «Salta, lo scrivo più tardi» or «Più tardi»: the write is already stopped when it runs. */
  onLater: () => void;
};

/** The footer buttons of the write: «Salta…» while it runs; «Scrivi di nuovo il link» and «Più tardi» after a failure. */
export function CardLinkWriterActions({ writing, onLater }: CardLinkWriterActionsProps) {
  const { state, canWrite } = writing;

  function later() {
    writing.stop();
    onLater();
  }

  if (state.status === 'written' || state.status === 'stopped') return null;
  if (state.status === 'failed') {
    return (
      <>
        <Button block onClick={writing.writeAgain}>
          Scrivi di nuovo il link
        </Button>
        <Button variant="secondary" block onClick={later}>
          Più tardi
        </Button>
      </>
    );
  }
  if (state.status === 'cannot-write' || (state.status === 'idle' && !canWrite)) {
    return (
      <Button variant="secondary" block onClick={later}>
        Più tardi
      </Button>
    );
  }
  return (
    <Button variant="secondary" block onClick={later}>
      Salta, lo scrivo più tardi
    </Button>
  );
}
