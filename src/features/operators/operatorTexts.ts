// Texts shared by the actions of the Operators screen (SPEC-operators point 6).

/** `upstream` and anything else: "dove è partita l'azione". */
export const GENERIC_ERROR = 'Operazione non riuscita. Riprova tra poco.';

/** EO001. */
export const LAST_ADMIN_ERROR =
  'Serve almeno un amministratore attivo: prima rendi amministratore un’altra persona.';

/** EO002: never expected, no action is offered on the own row. */
export const SELF_ERROR = 'Non puoi cambiare il tuo account da qui.';

/** EO005 and the note under Ruolo on the tablet. */
export const ADMIN_FROM_PHONE = 'Un amministratore si nomina dal telefono.';

/** EO004 / 409 `not_invited`. */
export function notInvitedError(name: string): string {
  return `${name} ha già accettato l’invito o non è attivo: ricarica l’elenco.`;
}

/** 429 of Auth, `rate_limited`. */
export const RATE_LIMITED_ERROR =
  'Troppe email inviate in poco tempo: l’invito non è partito. Riprova tra qualche minuto.';
