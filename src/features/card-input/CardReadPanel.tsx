import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import type { NfcStatus } from './cardReader';
import styles from './CardReadPanel.module.css';
import { useCardReaderState } from './useCardRead';

const OFF_TITLE = 'Lettura card spenta';
const OFF_TEXT =
  'Attiva l’NFC nelle impostazioni del telefono e torna qui. Su iPhone le card non si leggono: cerca il cliente per nome o telefono.';
const DENIED_TEXT =
  'Il permesso NFC è negato: consentilo a Enjoy Card nelle impostazioni di Chrome (Impostazioni sito → NFC) e riprova.';
const COMPACT_TEXT = 'Lettura attiva: puoi anche avvicinare la card';

type Content = {
  title: string;
  description: string;
  off: boolean;
  action?: { label: string; primary: boolean };
};

const RETRY = { label: 'Riprova la lettura', primary: false };

/** The reader is still starting: the tap has no outcome yet. */
const PENDING: ReadonlySet<NfcStatus> = new Set(['checking', 'starting']);

/** What the panel says in each state (SPEC-card-input, point 6). */
function contentFor(status: NfcStatus, title: string, description: string): Content {
  const contents: Record<NfcStatus, Content> = {
    checking: { title, description: 'Avvio della lettura…', off: false },
    starting: { title, description: 'Avvio della lettura…', off: false },
    active: { title, description, off: false },
    'needs-permission': {
      title: 'Lettura delle card',
      description: 'Serve una volta sola: il telefono chiede il permesso di usare l’NFC.',
      off: false,
      action: { label: 'Attiva la lettura', primary: true },
    },
    off: { title: OFF_TITLE, description: OFF_TEXT, off: true, action: RETRY },
    denied: { title: OFF_TITLE, description: DENIED_TEXT, off: true, action: RETRY },
    // Nothing to retry: the phone cannot read cards.
    unsupported: { title: OFF_TITLE, description: OFF_TEXT, off: true },
  };
  return contents[status];
}

/**
 * What the screen says about the last card it read (e.g. "Card disattivata" on the home): shown in
 * place of the active state's text, as an alert, while reading is active.
 */
export type CardReadNotice = {
  title?: string | undefined;
  text: string;
  /** A button or link under the text (e.g. "Riprova"). */
  action?: ReactNode;
};

export type CardReadPanelProps = {
  /** Title of the active state, from the screen that reads cards. */
  title: string;
  /** Text of the active state, from the screen that reads cards. */
  description: string;
  /** `usb`: the tablet with a USB reader; the Web NFC state is ignored. */
  mode?: 'web-nfc' | 'usb';
  /** `compact`: one line, only while reading is active (a search is on screen). */
  variant?: 'full' | 'compact';
  /** Shown only in the full variant, while reading is active; the screen picks `full` meanwhile. */
  notice?: CardReadNotice | null | undefined;
  /**
   * The panel replaces what a tap unmounted (e.g. «Riprova con un’altra card» in Associa card):
   * its text takes the focus when it mounts, so the focus does not fall to the page.
   */
  focusOnMount?: boolean | undefined;
};

type CardReadPanelViewProps = CardReadPanelProps & {
  status: NfcStatus;
  onStart: () => void;
};

/**
 * The "Lettura card" panel as a pure view of a reader status: used by `CardReadPanel` and by `/dev/ui`,
 * which shows every state without a reader.
 */
export function CardReadPanelView({
  title,
  description,
  mode = 'web-nfc',
  variant = 'full',
  notice = null,
  focusOnMount = false,
  status,
  onStart,
}: CardReadPanelViewProps) {
  // The tablet has no NFC: its USB reader has no state of its own to show.
  const effective: NfcStatus = mode === 'usb' ? 'active' : status;
  const texts = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (focusOnMount) texts.current?.focus();
  }, [focusOnMount]);
  // Set when the button is pressed while focused, until the tap has an outcome: the button unmounts
  // with the state change, so focus must not fall to the page (SPEC-card-input, point 6).
  const keepFocus = useRef(false);

  useLayoutEffect(() => {
    if (!keepFocus.current) return;
    const focused = document.activeElement;
    // The operator has moved on meanwhile: leave the focus where it is.
    if (focused !== null && focused !== document.body && focused !== texts.current) {
      keepFocus.current = false;
      return;
    }
    // The retry ended where it started (NFC still off): back on the button; otherwise on the
    // live text, which says the new state.
    (action.current ?? texts.current)?.focus();
    if (!PENDING.has(effective)) keepFocus.current = false;
  }, [effective]);

  function press() {
    keepFocus.current = document.activeElement === action.current;
    onStart();
  }

  if (variant === 'compact') {
    // The live region stays mounted, so the line is announced when reading becomes active.
    return (
      <div aria-live="polite">
        {effective === 'active' && (
          <section aria-label="Lettura card" className={styles.compact}>
            <Icon name="nfc" className={styles.icon} />
            <span className={styles.compactText}>{COMPACT_TEXT}</span>
          </section>
        )}
      </div>
    );
  }

  const content = contentFor(effective, title, description);
  if (notice !== null && effective === 'active') {
    return (
      <section aria-label="Lettura card" className={styles.panel}>
        <Icon name="nfc" size={48} className={styles.icon} />
        <div ref={texts} tabIndex={-1} role="alert" className={styles.texts}>
          {notice.title !== undefined && <p className={styles.title}>{notice.title}</p>}
          <p className={styles.noticeText}>{notice.text}</p>
        </div>
        {notice.action !== undefined && <div className={styles.action}>{notice.action}</div>}
      </section>
    );
  }
  return (
    <section aria-label="Lettura card" className={styles.panel} data-off={content.off || undefined}>
      <Icon name={content.off ? 'nfc-off' : 'nfc'} size={48} className={styles.icon} />
      <div ref={texts} tabIndex={-1} aria-live="polite" className={styles.texts}>
        <p className={styles.title}>{content.title}</p>
        <p className={styles.description}>{content.description}</p>
      </div>
      {content.action && (
        <Button
          variant={content.action.primary ? 'primary' : 'secondary'}
          {...(content.action.primary ? { icon: 'nfc' as const } : {})}
          block
          ref={action}
          className={styles.action}
          onClick={press}
        >
          {content.action.label}
        </Button>
      )}
    </section>
  );
}

/**
 * The "Lettura card" panel (SPEC-card-input, point 6): the state of card reading on this phone, with
 * the tap that starts it when the browser needs one. The screen puts the search below it.
 */
export function CardReadPanel(props: CardReadPanelProps) {
  const reader = useCardReaderState();
  return <CardReadPanelView {...props} status={reader.nfc} onStart={() => void reader.start()} />;
}
