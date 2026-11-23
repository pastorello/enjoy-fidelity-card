// Texts shared by the actions of the Operators screen (SPEC-operators point 6).

/** `upstream` and anything else: "dove è partita l'azione". */
export const GENERIC_ERROR = 'Operazione non riuscita. Riprova tra poco.';

/** EO001. */
export const LAST_ADMIN_ERROR =
  'Serve almeno un amministratore attivo: prima rendi amministratore un’altra persona.';

/** EO002: never expected, no action is offered on the own row. */
export const SELF_ERROR = 'Non puoi cambiare il tuo account da qui.';

/**
 * EO005 / 403 `admin_from_device`: on the till tablet an admin was invited, named or reactivated
 * without the cashier's PIN (Open Questions 11). Never expected: the app always asks it there.
 */
export const ADMIN_PIN_MISSING =
  'Dal tablet un amministratore si conferma con il tuo PIN: riprova.';

/** EO004 / 409 `not_invited`. */
export function notInvitedError(name: string): string {
  return `${name} ha già accettato l’invito o non è attivo: ricarica l’elenco.`;
}

/** 429 of Auth, `rate_limited`. */
export const RATE_LIMITED_ERROR =
  'Troppe email inviate in poco tempo: l’invito non è partito. Riprova tra qualche minuto.';

/** 409 `name_taken`, under Nome. */
export const NAME_TAKEN_ERROR =
  'Nome già usato: per gli omonimi aggiungi un dettaglio (es. Marco B.).';

/** 409 `email_taken`, under Email. */
export const EMAIL_TAKEN_ERROR = 'Questa email ha già un account.';

/** 409 `email_taken` with `deactivated`, under Email. */
export const EMAIL_DEACTIVATED_ERROR =
  'Questa email è di una persona disattivata: riattivala dall’elenco.';

/** 409 `email_is_device`, under Email. */
export const EMAIL_IS_DEVICE_ERROR = 'Questa è l’email dell’account del tablet: usane un’altra.';

/** 409 `in_progress`, under "Invia invito". */
export const IN_PROGRESS_ERROR = 'L’invito è ancora in corso: riprova tra qualche secondo.';

/** No answer to an invite, under "Invia invito": a new tap resends the same `operation_id`. */
export const INVITE_NETWORK_ERROR =
  'Connessione assente: l’invito potrebbe non essere partito. Riprova.';
