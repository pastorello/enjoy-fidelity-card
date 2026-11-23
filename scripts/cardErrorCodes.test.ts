import { describe, expect, it } from 'vitest';
import { CUSTOMER_ERROR_CODES } from '../src/features/customers/errorCodes';
import { CARD_ERROR_CODES } from '../src/features/cards/supabaseCardsService';
import { liveFunctionsIn, raisedMessageCodes } from './migrationFunctions';

// SPEC-cards, "Modello dati": supabaseCardsService translates every message-code the cards RPCs raise
// (errcode P0001) into a typed error. A code raised by a migration but missing from
// CARD_ERROR_CODES would reach the screens as 'unknown'. SPEC-customers-v2, "Codici d'errore": the
// codes are those of the latest definition of each function still present whose latest definition is
// in a `_cards*.sql` migration (cards and cards_v2_release). create_customer_with_card, last
// redefined by customers_v2_email, also raises the codes of app.create_customer, which the service
// hands on as CustomerError.

const CARD_MIGRATIONS = /_cards[a-z0-9_]*\.sql$/;
const CUSTOMER_MIGRATIONS = /_customers[a-z0-9_]*\.sql$/;

/**
 * The codes cards_v2_release raises that the app does not translate yet: task 28 of
 * tasks/customers-v2 adds them to CARD_ERROR_CODES, each with its typed error, and empties this list.
 */
const AWAITING_TRANSLATION: ReadonlySet<string> = new Set([
  'active_card_changed',
  'card_active',
  'card_released',
  'forbidden',
]);

const sorted = (codes: readonly string[]) => codes.toSorted((a, b) => a.localeCompare(b));

describe('card error codes', () => {
  // Title cited by tasks/cards/plan.md (criterion 9): "the cards migration" is now the live
  // functions of cards and cards_v2_release.
  it('lists exactly the codes the cards migration raises, once each', () => {
    expect(new Set(CARD_ERROR_CODES).size).toBe(CARD_ERROR_CODES.length);
    const raised = raisedMessageCodes(liveFunctionsIn(CARD_MIGRATIONS));
    expect(raised).toEqual(expect.arrayContaining([...AWAITING_TRANSLATION]));
    expect(sorted(CARD_ERROR_CODES)).toEqual(
      raised.filter((code) => !AWAITING_TRANSLATION.has(code)),
    );
  });

  it('keeps the list of codes awaiting translation honest: none is translated yet', () => {
    expect(CARD_ERROR_CODES.filter((code) => AWAITING_TRANSLATION.has(code))).toEqual([]);
  });

  it('translates every code the live customers functions raise inside create_customer_with_card', () => {
    const translated = new Set<string>([...CARD_ERROR_CODES, ...CUSTOMER_ERROR_CODES]);
    const untranslated = raisedMessageCodes(liveFunctionsIn(CUSTOMER_MIGRATIONS)).filter(
      (code) => !translated.has(code),
    );
    expect(untranslated).toEqual([]);
  });
});
