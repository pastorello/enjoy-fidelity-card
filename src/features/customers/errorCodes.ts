/**
 * The single list of the message-codes the customers RPCs raise (errcode P0001) and the Italian
 * text the app shows for each (SPEC-customers, "Errori del modulo"). `errorCodes.test.ts` checks the
 * list against the migration, so a new server code cannot go untranslated.
 */

export const CUSTOMER_ERROR_CODES = [
  'not_operator',
  'forbidden',
  'name_required',
  'name_too_long',
  'phone_invalid',
  'consent_required',
  'notes_too_long',
  'customer_name_taken',
  'customer_not_found',
  'customer_anonymized',
] as const;

export type CustomerErrorCode = (typeof CUSTOMER_ERROR_CODES)[number];

/** The form field a code is shown under; null when it belongs to the whole page. */
export type CustomerField = 'name' | 'phone' | 'consent' | 'notes';

const ERRORS: Record<CustomerErrorCode, { text: string; field: CustomerField | null }> = {
  // identity's sign-in message: the app signs out and shows it on /accedi.
  not_operator: { text: 'Account non abilitato: chiedi a un amministratore.', field: null },
  forbidden: { text: 'Solo un amministratore può cancellare i dati di un cliente.', field: null },
  name_required: { text: 'Scrivi nome e cognome.', field: 'name' },
  name_too_long: { text: 'Al massimo 80 caratteri.', field: 'name' },
  phone_invalid: {
    text: 'Numero non valido: scrivi solo le cifre, con o senza prefisso.',
    field: 'phone',
  },
  consent_required: {
    text: 'Serve il consenso privacy per registrare il cliente.',
    field: 'consent',
  },
  notes_too_long: { text: 'Al massimo 500 caratteri.', field: 'notes' },
  customer_name_taken: { text: 'Esiste già un cliente con questo nome.', field: 'name' },
  customer_not_found: { text: 'Cliente non trovato', field: null },
  // Proposed text (SPEC-customers, Open Question 13): the edit page redirects before it shows.
  customer_anonymized: { text: 'I dati di questo cliente sono stati cancellati.', field: null },
};

export function isCustomerErrorCode(value: string): value is CustomerErrorCode {
  return CUSTOMER_ERROR_CODES.some((code) => code === value);
}

export function customerErrorText(code: CustomerErrorCode): string {
  return ERRORS[code].text;
}

export function customerErrorField(code: CustomerErrorCode): CustomerField | null {
  return ERRORS[code].field;
}
