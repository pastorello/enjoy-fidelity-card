import { ServerFaultError } from '../../lib/serverFault';
import { Button, ButtonLink } from '../../shared/ui/Button';
import type { CardReadNotice } from '../card-input/CardReadPanel';
import { loadErrorText } from '../customers/loadErrorText';
import { firstName, NOT_IN_DISPLAY } from './customerName';
import styles from './homeCardNotice.module.css';
import { NetworkError } from './types';
import type { HomeCardRead } from './useHomeCardRead';

/** Why a card read was not looked up: shared by every screen that reads cards. */
export function cardReadErrorText(error: unknown): string {
  if (error instanceof ServerFaultError) return `Card non letta. ${loadErrorText(error)}`;
  if (error instanceof NetworkError) return 'Card non letta: controlla la connessione.';
  return 'Card non letta: riprova.';
}

/** The title of a card that is not active, read by an operator (SPEC-customers-v2, point 4). */
const NOT_ACTIVE_TITLE = 'Card non attiva: chiedi a un amministratore';

/**
 * What the card panel of the home says about the last card read (SPEC-cards, point 1, and
 * SPEC-customers-v2, point 4), or null when it shows its own text. "Lettura della card…" is the panel's description instead (see HomePage).
 */
export function homeCardNotice(read: HomeCardRead): CardReadNotice | null {
  if (read.status === 'idle' || read.status === 'reading') return null;
  if (read.status === 'inactive') {
    const name = firstName(read.customerName);
    return {
      title: NOT_ACTIVE_TITLE,
      text: `Era la card di ${read.customerName}. Per servirla adesso cercala per nome o email.`,
      action: (
        <ButtonLink to={`/clienti/${read.customerId}`} variant="secondary" block>
          {/* One flex item: the button's gap must not widen the space before the name. */}
          <span>
            Apri la scheda di{' '}
            <span className={NOT_IN_DISPLAY.test(name) ? styles.typedName : undefined}>{name}</span>
          </span>
        </ButtonLink>
      ),
    };
  }
  if (read.status === 'anonymized') {
    return {
      title: NOT_ACTIVE_TITLE,
      text: 'I dati del cliente di questa card sono stati cancellati.',
    };
  }
  return {
    text: cardReadErrorText(read.error),
    action: (
      <Button variant="secondary" block onClick={read.retry}>
        Riprova
      </Button>
    ),
  };
}
